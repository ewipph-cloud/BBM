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

Buka `http://localhost:3000`, buat akun, lalu klik kartu profil Anda di bagian atas daftar chat untuk melihat dan menyalin **PIN BBM 8 karakter**. Teman dapat memulai chat memakai PIN tersebut atau email akun yang sudah terdaftar.

Di dalam chat, tombol **Ping** mengirim pesan Ping real-time. Aktifkan ikon speaker di header chat untuk mengizinkan bunyi Ping; browser dapat meminta izin notifikasi. Getaran hanya tersedia pada browser/perangkat yang mendukungnya. Ping memberi notifikasi saat aplikasi masih terbuka; notifikasi ketika aplikasi tertutup memerlukan Firebase Cloud Messaging dan belum tersedia.

### Deploy Firestore Rules

Firebase Admin SDK tidak menerbitkan Security Rules. Gunakan Firebase CLI dengan service account yang memiliki izin mengelola Firestore Rules:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
  npx firebase-tools deploy --only firestore:rules --project YOUR_FIREBASE_PROJECT_ID
```

`firebase.json` menunjuk ke `firestore.rules` untuk perintah deploy tersebut.

## Deploy ke Vercel

Impor repository ini ke Vercel, tambahkan semua variabel dari `.env.example` di **Project Settings → Environment Variables**, lalu deploy. Jika nilai environment berubah, lakukan redeploy.

## Struktur data

- `users/{uid}` — email dan waktu pembuatan akun.
- `pins/{PIN}` — pemetaan PIN publik ke UID pengguna; PIN dibuat unik melalui transaksi Firestore.
- `chats/{uid1_uid2}` — anggota, alamat email anggota, pesan terakhir, dan waktu pembaruan.
- `chats/{chatId}/messages/{messageId}` — pesan chat.
- Realtime Database `presence/{uid}` — status online/offline; offline diatur dengan `onDisconnect`.

Firestore menyimpan riwayat pesan dan daftar percakapan; Realtime Database dipakai untuk presence. Presence hanya dapat ditulis pemilik UID dan dibaca oleh pengguna yang sudah login. Aturan Firestore membatasi chat/pesan ke anggota percakapan. Aplikasi ini adalah fondasi MVP, belum mencakup grup, upload media, enkripsi end-to-end, atau notifikasi push.

PIN adalah identitas pencarian untuk memulai chat, bukan kata sandi atau faktor autentikasi. Pengguna lama mendapat PIN saat masuk setelah versi ini dipasang; pastikan aturan terbaru dari `firestore.rules` sudah diterapkan.
