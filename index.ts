// ICT School Management System
// Supabase Edge Function: ict-sync-accounts
//
// Required Edge Function Secrets:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//
// Security:
// - verify_jwt is disabled at the gateway so this function can validate the
//   incoming user token itself.
// - Every POST request is verified with Auth.getUser().
// - Only users with app_metadata.role === "admin" and active === true may proceed.
// - Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function requiredEnv() {
  const missing = [
    ["SUPABASE_URL", SUPABASE_URL],
    ["SUPABASE_ANON_KEY", SUPABASE_ANON_KEY],
    ["SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY],
  ].filter(([, value]) => !value).map(([name]) => name);

  return missing;
}

function normalizeRole(value: unknown): "teacher" | "student" | null {
  const role = String(value ?? "").trim().toLowerCase();
  return role === "teacher" || role === "student" ? role : null;
}

function base64UrlUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// Must match doctype.html loginEmailFor() exactly.
function authEmailFor(username: string, role: "teacher" | "student"): string {
  if (role === "teacher") return username.trim().toLowerCase();
  return `student-${base64UrlUtf8(username.trim())}@ict-school.example.com`;
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function findAuthUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  // Auth Admin listUsers is paginated. Scan pages to avoid duplicate user creation.
  const perPage = 1000;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((user) =>
      String(user.email ?? "").toLowerCase() === email.toLowerCase()
    );
    if (found) return found;
    if (data.users.length < perPage) break;
  }
  return null;
}

async function validateAdministrator(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Bearer token Administrator tidak ditemukan.");

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await authClient.auth.getUser(match[1]);
  if (error || !data.user) {
    throw new Error("Token Administrator tidak valid atau sudah kedaluwarsa.");
  }

  const metadata = data.user.app_metadata ?? {};
  if (
    String(metadata.role ?? "").toLowerCase() !== "admin" ||
    metadata.active !== true
  ) {
    throw new Error("Akses ditolak. Hanya Administrator aktif yang boleh menjalankan fungsi ini.");
  }

  return data.user;
}

async function syncOneAccount(admin: ReturnType<typeof createClient>, account: Record<string, unknown>) {
  const role = normalizeRole(account.role);
  if (!role) throw new Error("Role hanya boleh teacher atau student.");

  const username = String(account.username ?? "").trim();
  if (!username) throw new Error("Username/email/ISN wajib diisi.");

  const email = role === "teacher"
    ? String(account.email || username).trim().toLowerCase()
    : authEmailFor(String(account.isn || username), "student");

  if (!validEmail(email)) throw new Error("Alamat email Auth tidak valid.");

  const password = typeof account.password === "string" ? account.password : "";
  const forcePasswordUpdate = account.forcePasswordUpdate === true;
  if (password && password.length < 8) {
    throw new Error("Password minimal 8 karakter.");
  }

  let authUser = await findAuthUserByEmail(admin, email);
  let passwordUpdated = false;

  const userMetadata = {
    role,
    username,
    email: role === "teacher" ? email : "",
    isn: role === "student" ? String(account.isn || username) : "",
    name: String(account.name ?? ""),
    level: String(account.level ?? ""),
    className: String(account.className ?? ""),
    major: String(account.major ?? ""),
    teachingLevels: Array.isArray(account.teachingLevels) ? account.teachingLevels : [],
    subject: String(account.subject ?? ""),
    classNames: Array.isArray(account.classNames) ? account.classNames : [],
    active: account.active !== false,
  };

  const appMetadata = {
    role,
    username,
    isn: role === "student" ? String(account.isn || username) : "",
    name: String(account.name ?? ""),
    level: String(account.level ?? ""),
    className: String(account.className ?? ""),
    major: String(account.major ?? ""),
    teachingLevels: Array.isArray(account.teachingLevels) ? account.teachingLevels : [],
    subject: String(account.subject ?? ""),
    classNames: Array.isArray(account.classNames) ? account.classNames : [],
    active: account.active !== false,
  };

  if (!authUser) {
    if (!password) {
      throw new Error("Akun Auth belum ada. Administrator harus menetapkan password sebelum membuat akun baru.");
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: appMetadata,
      user_metadata: userMetadata,
    });
    if (error) throw error;
    authUser = data.user;
    passwordUpdated = true;
  } else {
    const update: Record<string, unknown> = {
      app_metadata: { ...(authUser.app_metadata ?? {}), ...appMetadata },
      user_metadata: { ...(authUser.user_metadata ?? {}), ...userMetadata },
    };
    if (password && (forcePasswordUpdate || password.length >= 8)) {
      update.password = password;
      passwordUpdated = true;
    }

    const { data, error } = await admin.auth.admin.updateUserById(authUser.id, update);
    if (error) throw error;
    authUser = data.user;
  }

  const profile = {
    id: authUser.id,
    role,
    username,
    email: role === "teacher" ? email : null,
    name: String(account.name ?? ""),
    isn: role === "student" ? String(account.isn || username) : null,
    level: String(account.level ?? ""),
    class_name: String(account.className ?? ""),
    major: String(account.major ?? ""),
    teaching_levels: Array.isArray(account.teachingLevels) ? account.teachingLevels : [],
    subject: String(account.subject ?? ""),
    class_names: Array.isArray(account.classNames) ? account.classNames : [],
    active: account.active !== false,
    updated_at: new Date().toISOString(),
  };

  const { error: profileError } = await admin
    .from("ict_profiles")
    .upsert(profile, { onConflict: "id" });

  if (profileError) {
    throw new Error(`Auth berhasil diproses, tetapi penyimpanan ict_profiles gagal: ${profileError.message}`);
  }

  return {
    username,
    email,
    role,
    status: "synced",
    auth_user_id: authUser.id,
    password_updated: passwordUpdated,
  };
}

async function deleteOneAccount(admin: ReturnType<typeof createClient>, item: Record<string, unknown>) {
  const role = normalizeRole(item.role);
  if (!role) throw new Error("Role penghapusan tidak valid.");

  const username = String(item.username ?? "").trim();
  if (!username) throw new Error("Username/email/ISN wajib diisi.");

  const email = role === "teacher"
    ? username.toLowerCase()
    : authEmailFor(username, "student");

  const authUser = await findAuthUserByEmail(admin, email);
  if (!authUser) return { username, role, status: "not_found" };

  const { error: profileError } = await admin
    .from("ict_profiles")
    .delete()
    .eq("id", authUser.id);

  if (profileError) {
    throw new Error(`Gagal menghapus profil ict_profiles: ${profileError.message}`);
  }

  const { error } = await admin.auth.admin.deleteUser(authUser.id);
  if (error) throw error;

  return { username, role, status: "deleted" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const missing = requiredEnv();
  if (missing.length) {
    return json({ ok: false, error: `Edge Function Secrets belum lengkap: ${missing.join(", ")}` }, 500);
  }

  if (req.method === "GET") {
    return json({
      ok: true,
      service: "ict-sync-accounts",
      project_ref: new URL(SUPABASE_URL).hostname.split(".")[0],
      secrets_present: {
        SUPABASE_URL: Boolean(SUPABASE_URL),
        SUPABASE_ANON_KEY: Boolean(SUPABASE_ANON_KEY),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      },
    });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    await validateAdministrator(req);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const payload = await req.json();
    const results: Record<string, unknown>[] = [];
    const deleted: Record<string, unknown>[] = [];

    if (Array.isArray(payload.accounts)) {
      for (const account of payload.accounts) {
        try {
          results.push(await syncOneAccount(admin, account ?? {}));
        } catch (error) {
          results.push({
            username: String(account?.username ?? account?.email ?? ""),
            email: String(account?.email ?? ""),
            status: "failed",
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (Array.isArray(payload.deleteAccounts)) {
      for (const item of payload.deleteAccounts) {
        try {
          deleted.push(await deleteOneAccount(admin, item ?? {}));
        } catch (error) {
          deleted.push({
            username: String(item?.username ?? ""),
            status: "failed",
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (!Array.isArray(payload.accounts) && !Array.isArray(payload.deleteAccounts)) {
      return json({ ok: false, error: "Payload harus memiliki accounts atau deleteAccounts berupa array." }, 400);
    }

    return json({
      ok: true,
      processed: results.length,
      results,
      deleted,
      request_id: crypto.randomUUID(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /token|administrator|akses ditolak|bearer/i.test(message) ? 401 : 500;
    return json({ ok: false, error: message }, status);
  }
});
