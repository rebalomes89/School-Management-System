# ICT School Management System — GitHub + Render

## Arsitektur
- `frontend/`: website single-file HTML/CSS/JS untuk GitHub Pages.
- `backend/`: Python Flask REST API untuk Render Web Service.
- Render PostgreSQL: database server.
- `render.yaml`: Render Blueprint untuk membuat database dan API.

GitHub Pages tidak menjalankan Python/Flask/PostgreSQL. Backend dan database tetap berada di Render.

## Deploy
1. Push seluruh isi repository ke GitHub.
2. Di Render pilih New > Blueprint, hubungkan repository, lalu deploy `render.yaml`.
3. Saat Render meminta `ADMIN_PASSWORD` dan `CORS_ORIGINS`, isi password admin baru dan origin GitHub Pages, misalnya `https://USERNAME.github.io`.
4. Pastikan service sehat pada `/api/health`.
5. Edit `frontend/index.html`: ganti URL `https://GANTI-NAMA-SERVICE.onrender.com` dengan URL Web Service Render sebenarnya.
6. Upload `frontend/index.html` ke repository frontend GitHub Pages (atau gunakan folder frontend sebagai root repo terpisah).
7. Di GitHub: Settings > Pages > Deploy from a branch > main > /(root).

## Perintah Render manual
Root Directory: `backend`
Build: `pip install -r requirements.txt`
Start: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 120`
Health check: `/api/health`

## Login
- Admin: `ADMIN_USERNAME` dan `ADMIN_PASSWORD` dari Render Environment.
- Teacher: email/username yang ada di `state.users`.
- Student: ISN/username yang ada di `state.users`.
Role harus dipilih sesuai akun.

## Migrasi data lama
1. Pada browser lama yang masih menyimpan data, buka DevTools > Console:
   `copy(localStorage.getItem("ict_school_management_v1"))`
2. Simpan hasil sebagai `ict-school-state.json`.
3. Jangan upload file ini ke GitHub.
4. Setelah API aktif, login Admin dari frontend yang memiliki data lokal lama. Frontend akan menggabungkan akun/data lokal dan menjalankan sinkronisasi awal admin ke API.
5. Alternatif untuk impor lewat shell: jalankan script `python scripts/import_local_state.py ict-school-state.json` pada environment backend yang memiliki DATABASE_URL.
6. Verifikasi akun, assignment, submission, dan Scorelist sebelum menghapus cache browser lama.

## Catatan penting
- Backend lama menyimpan state sebagai satu JSONB record untuk kompatibilitas dengan single-file app. Ini adalah tahap migrasi, bukan skema relasional final.
- Saat ini endpoint `/api/state` full sync hanya untuk Admin. Teacher/Student login dapat membaca state API tetapi penulisan data domain perlu endpoint scoped khusus sebelum go-live. Jangan gunakan untuk ujian resmi 100 siswa bersamaan sampai endpoint submission/answer/scorelist dipisah, transaksi per submission, role authorization per record, backup/restore diuji dan load test 100-150 concurrent clients dilakukan.
- Jangan masukkan secrets ke GitHub.
