# Ruang

Starter aplikasi chat 1:1 berbasis Next.js, Firebase Authentication, Cloud Firestore, dan Realtime Database. Siap dijalankan lokal atau di-deploy ke Vercel.

## Menjalankan lokal

1. Gunakan Node.js 20.9 atau lebih baru.
2. Buat project di [Firebase Console](https://console.firebase.google.com/), daftarkan aplikasi web, lalu salin konfigurasi web.
3. Aktifkan **Authentication → Email/Password**, buat database **Cloud Firestore**, dan aktifkan **Realtime Database**.
4. Salin `.env.example` menjadi `.env.local`, lalu isi semua nilai konfigurasi Firebase. `NEXT_PUBLIC_FIREBASE_DATABASE_URL` harus memakai URL dari halaman Realtime Database.
5. Terapkan isi `firestore.rules` pada Firestore Rules dan `database.rules.json` pada Realtime Database Rules.
6. Jalankan:

   ```bash
   npm install
   npm run dev
   ```

Buka `http://localhost:3000`, buat akun, lalu mulai chat menggunakan email akun lain yang sudah terdaftar.

## Deploy ke Vercel

Impor repository ini ke Vercel, tambahkan semua variabel dari `.env.example` di **Project Settings → Environment Variables**, lalu deploy. Jika nilai environment berubah, lakukan redeploy.

## Struktur data

- `users/{uid}` — email dan waktu pembuatan akun.
- `chats/{uid1_uid2}` — anggota, alamat email anggota, pesan terakhir, dan waktu pembaruan.
- `chats/{chatId}/messages/{messageId}` — pesan chat.
- Realtime Database `presence/{uid}` — status online/offline; offline diatur dengan `onDisconnect`.

Firestore menyimpan riwayat pesan dan daftar percakapan; Realtime Database dipakai untuk presence. Presence hanya dapat ditulis pemilik UID dan dibaca oleh pengguna yang sudah login. Aturan Firestore membatasi chat/pesan ke anggota percakapan. Aplikasi ini adalah fondasi MVP, belum mencakup grup, upload media, enkripsi end-to-end, atau notifikasi push.
