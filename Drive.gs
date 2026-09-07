/**
 * Drive.gs
 * Manajemen folder & file Google Drive untuk berkas pengajuan KIA.
 * APLIKASI PENDATAAN & PENGAJUAN KIA - KOTA MAKASSAR (RUNNING 2)
 *
 * Struktur folder:
 * KIA / Kecamatan / Nama Sekolah / Kelas Rombel / Nama Siswa
 */

var ROOT_FOLDER_NAME = "KIA";

/**
 * Mengambil folder anak dengan nama tertentu di dalam folder induk.
 * Jika belum ada, folder baru akan dibuat. Tidak pernah membuat folder
 * duplikat untuk nama yang sama.
 */
function getOrCreateFolder(parentFolder, name) {
  var safeName = sanitizeName(name);
  var iter = parentFolder.getFoldersByName(safeName);
  if (iter.hasNext()) {
    return iter.next();
  }
  return parentFolder.createFolder(safeName);
}

/**
 * Mengambil (atau membuat) folder root "KIA" di Drive milik akun
 * yang menjalankan script (Execute as: Me pada saat deploy).
 */
function getRootKiaFolder() {
  var root = DriveApp.getRootFolder();
  var iter = root.getFoldersByName(ROOT_FOLDER_NAME);
  if (iter.hasNext()) {
    return iter.next();
  }
  return root.createFolder(ROOT_FOLDER_NAME);
}

/**
 * Mengambil (atau membuat) folder tujuan akhir untuk satu siswa:
 * KIA / Kecamatan / Nama Sekolah / Kelas Rombel / Nama Siswa
 */
function getStudentFolder(kecamatan, namaSekolah, kelasRombel, namaSiswa) {
  var kia = getRootKiaFolder();
  var fKecamatan = getOrCreateFolder(kia, kecamatan || "Tanpa Kecamatan");
  var fSekolah = getOrCreateFolder(fKecamatan, namaSekolah || "Tanpa Sekolah");
  var fKelas = getOrCreateFolder(fSekolah, kelasRombel || "Tanpa Kelas");
  var fSiswa = getOrCreateFolder(fKelas, namaSiswa || "Tanpa Nama");
  return fSiswa;
}

/**
 * Memastikan file TIDAK bisa diakses hanya dengan mengetahui URL-nya.
 * Akses dibatasi hanya untuk pemilik/akun yang berwenang (private).
 * Dashboard Dinas/Capil pada RUNNING berikutnya dapat diberi akses resmi
 * secara terpisah (mis. lewat domain/grup), bukan lewat "anyone with link".
 */
function ensurePrivate(file) {
  try {
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (err) {
    // Sebagian akun (mis. Workspace dengan kebijakan domain) mungkin
    // membatasi setSharing; abaikan agar proses utama tidak gagal total.
    Logger.log("ensurePrivate warning: " + err);
  }
}

/**
 * RUNNING 3.6 — KHUSUS file PDF GABUNGAN (Formulir+Akta+KK+KTP) yang dilihat
 * Capil lewat link langsung (?page=viewdoc, lihat Code.gs).
 *
 * KENAPA BEDA DARI ensurePrivate()?
 * Capil "login" pakai KODE AKSES bersama (bukan akun Google pribadi), jadi
 * tidak bisa diberi izin Drive personal. Menyisipkan SELURUH isi file besar
 * ini sebagai base64 langsung ke HTML (cara sebelumnya) melebihi batas yang
 * sanggup ditangani sandboxing Apps Script untuk file berukuran besar (hasil
 * scan 4 halaman), sehingga halamannya blank. Solusinya: file ini diset
 * "Siapa saja yang memiliki link dapat melihat", lalu Capil diarahkan
 * (redirect) langsung ke link Drive-nya SETELAH lolos validasi kode akses +
 * status submit sekolah di server (lihat resolveDokumenBlob_ di
 * DashboardBackend.gs) -- link Drive itu sendiri TIDAK PERNAH ditampilkan
 * ke siapa pun sebelum validasi tsb berhasil.
 *
 * TRADE-OFF KEAMANAN (disepakati bersama pengguna aplikasi): File ID Google
 * Drive adalah string acak panjang yang praktis tidak bisa ditebak, TAPI
 * jika link ini sampai diteruskan/bocor ke pihak lain, PDF tsb (berisi data
 * pribadi anak & orang tua) bisa dilihat tanpa kode akses lagi. HANYA file
 * gabungan ini yang diset begini -- dokumen lain (foto/ttd/formulir/akta/
 * kk/ktp satuan) tetap PRIVATE sepenuhnya lewat ensurePrivate() seperti biasa.
 */
function ensureLinkViewableForCapil(file) {
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    Logger.log("ensureLinkViewableForCapil warning: " + err);
  }
}

/**
 * Menyimpan data base64 sebagai file biasa (dipakai untuk Foto & Tanda Tangan).
 */
function saveBase64AsFile(folder, base64Data, mimeType, fileName) {
  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, mimeType, fileName);
  var file = folder.createFile(blob);
  ensurePrivate(file);
  return file;
}

/**
 * Mengonversi sebuah blob gambar menjadi file PDF satu halaman
 * (dipakai ketika Akta/KK/KTP diunggah dalam format JPG/PNG, bukan PDF).
 * Membuat Google Doc sementara, lalu langsung dihapus setelah PDF diambil.
 */
function convertImageBlobToPdf(imageBlob, targetBaseName) {
  var doc = DocumentApp.create(targetBaseName + "_temp");
  var body = doc.getBody();
  body.setMarginTop(20);
  body.setMarginBottom(20);
  body.setMarginLeft(20);
  body.setMarginRight(20);

  var img = body.appendImage(imageBlob);
  var maxWidth = 500; // pt, agar pas di halaman A4/Letter dengan margin di atas
  if (img.getWidth() > maxWidth) {
    var ratio = maxWidth / img.getWidth();
    img.setWidth(maxWidth);
    img.setHeight(img.getHeight() * ratio);
  }
  doc.saveAndClose();

  var docFile = DriveApp.getFileById(doc.getId());
  var pdfBlob = docFile.getAs("application/pdf").setName(targetBaseName + ".pdf");
  // RUNNING 4: docFile.setTrashed(true) SENGAJA TIDAK dipanggil di sini lagi.
  // Membuangnya di sini berarti 1 panggilan Drive API SINKRON tambahan yang
  // harus ditunggu setiap kali ada gambar dikonversi ke PDF (bisa sampai 3x
  // dalam satu proses upload: Akta/KK/KTP) -- ikut memperlambat waktu
  // tunggu pengguna. File Google Docs sementara ini ("..._temp") sekarang
  // dibuang belakangan lewat trigger terjadwal bersihkanDokumenSementara()
  // di bawah, sehingga tidak lagi menghalangi respons ke pengguna.
  return pdfBlob;
}

/**
 * RUNNING 4 — Membuang seluruh file Google Docs sementara ("...???_temp",
 * dipakai sebagai "mesin render" konversi gambar->PDF & pembuatan Formulir
 * KIA di convertImageBlobToPdf & generateFormulirKiaPdf) yang tertinggal.
 * TIDAK dipanggil saat upload berlangsung -- jalankan lewat trigger
 * terjadwal saja supaya tidak memperlambat pengguna.
 *
 * CARA PASANG (SEKALI SAJA): Apps Script Editor -> ikon jam "Triggers" di
 * sisi kiri -> Add Trigger -> Function: "bersihkanDokumenSementara",
 * Event source: "Time-driven", Type: "Hour timer" (mis. tiap 1 jam).
 */
function bersihkanDokumenSementara() {
  var it = DriveApp.searchFiles(
    "title contains '_temp' and mimeType = '" + MimeType.GOOGLE_DOCS + "' and trashed = false"
  );
  var jumlah = 0;
  while (it.hasNext()) {
    var f = it.next();
    try {
      f.setTrashed(true);
      jumlah++;
    } catch (e) {
      Logger.log("bersihkanDokumenSementara: gagal membuang 1 file, dilewati: " + e);
    }
  }
  Logger.log("bersihkanDokumenSementara: " + jumlah + " file Google Docs sementara dibuang.");
}

/**
 * Menyimpan berkas dokumen (Akta/KK/KTP) sebagai PDF ke dalam folder siswa.
 * Jika file asli sudah PDF, langsung disimpan. Jika berupa gambar (JPG/PNG),
 * dikonversi dulu menjadi PDF agar seragam ("prioritaskan PDF").
 */
function saveDocumentAsPdf(folder, fileMeta, targetBaseName) {
  var ext = getFileExtension(fileMeta.filename);
  var bytes = Utilities.base64Decode(fileMeta.base64);
  var rawBlob = Utilities.newBlob(bytes, fileMeta.mimeType || "application/octet-stream", fileMeta.filename);

  var pdfBlob;
  if (ext === "pdf") {
    pdfBlob = rawBlob.setName(targetBaseName + ".pdf");
  } else {
    pdfBlob = convertImageBlobToPdf(rawBlob, targetBaseName);
  }

  var file = folder.createFile(pdfBlob);
  ensurePrivate(file);
  return file;
}