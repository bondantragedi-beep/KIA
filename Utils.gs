/**
 * Utils.gs
 * Kumpulan fungsi utilitas: validasi, generator ID, dan fungsi logo.
 * APLIKASI PENDATAAN & PENGAJUAN KIA - KOTA MAKASSAR
 */

// ==================================================
// GENERATOR ID
// ==================================================

/**
 * Membuat ID Pengajuan unik dengan format: KIA-yyyyMMdd-xxxx
 * xxxx adalah angka random 4 digit + cek belum dipakai di sheet siswa.
 */
function generateIdPengajuan() {
  var sheet = getSheet(SHEET_SISWA);
  var existingIds = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    ids.forEach(function (row) {
      if (row[0]) existingIds[row[0]] = true;
    });
  }

  var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Makassar", "yyyyMMdd");
  var newId;
  var attempt = 0;
  do {
    var rand = Math.floor(1000 + Math.random() * 9000);
    newId = "KIA-" + todayStr + "-" + rand;
    attempt++;
  } while (existingIds[newId] && attempt < 50);

  return newId;
}

// ==================================================
// VALIDASI (dipakai ulang di backend, mencerminkan validasi frontend)
// ==================================================

/**
 * Validasi umum untuk seluruh payload data siswa.
 * Mengembalikan { valid: true } atau { valid: false, errors: [...] }
 */
function validateSiswaPayload(data) {
  var errors = [];

  if (!data.npsn || !isValidNPSNFormat(data.npsn)) {
    errors.push("NPSN tidak valid.");
  }
  if (!data.jenjang || !isValidJenjang(data.jenjang)) {
    errors.push("Jenjang tidak valid. Jenjang harus salah satu dari TPA, KB, TK, SD, SMP (mengikuti Bentuk Pendidikan sekolah).");
  }
  if (!data.kelasRombel) {
    errors.push("Kelas/Rombel wajib dipilih.");
  }
  if (!data.namaAnak || String(data.namaAnak).trim() === "") {
    errors.push("Nama anak wajib diisi.");
  }
  if (!data.nik || !isValid16Digit(data.nik)) {
    errors.push("NIK harus berupa 16 digit angka.");
  }
  if (!data.nomorKK || !isValid16Digit(data.nomorKK)) {
    errors.push("Nomor Kartu Keluarga harus berupa 16 digit angka.");
  }
  if (!data.tempatLahir || String(data.tempatLahir).trim() === "") {
    errors.push("Tempat lahir wajib diisi.");
  }
  if (!data.tanggalLahir) {
    errors.push("Tanggal lahir wajib diisi.");
  }
  if (!data.jenisKelamin) {
    errors.push("Jenis kelamin wajib dipilih.");
  }
  if (!data.alamatTinggal || String(data.alamatTinggal).trim() === "") {
    errors.push("Alamat tempat tinggal wajib diisi.");
  }
  if (!data.namaKepalaKeluarga || String(data.namaKepalaKeluarga).trim() === "") {
    errors.push("Nama kepala keluarga wajib diisi.");
  }
  if (!data.namaAyah || String(data.namaAyah).trim() === "") {
    errors.push("Nama ayah wajib diisi.");
  }
  if (!data.namaIbu || String(data.namaIbu).trim() === "") {
    errors.push("Nama ibu wajib diisi.");
  }
  if (!data.namaPelapor || String(data.namaPelapor).trim() === "") {
    errors.push("Nama pelapor wajib diisi.");
  }
  if (!data.nomorHpPelapor || String(data.nomorHpPelapor).trim() === "") {
    errors.push("Nomor telepon/HP pelapor wajib diisi.");
  }

  return { valid: errors.length === 0, errors: errors };
}

function isValid16Digit(value) {
  var str = String(value).trim();
  return /^\d{16}$/.test(str);
}

function isValidNPSNFormat(value) {
  var str = String(value).trim();
  // NPSN Indonesia umumnya 8 digit angka
  return /^\d{6,10}$/.test(str);
}

// RUNNING 3.1: daftar jenjang baku setelah "PAUD" dipecah menjadi TPA/KB/TK
// pada sheet `db` (kolom Bentuk Pendidikan). Dipakai untuk validasi ULANG di
// server — jenjang TIDAK LAGI dipilih manual oleh orang tua di frontend,
// tapi payload tetap divalidasi di sini agar tidak mempercayai client mentah.
var DAFTAR_JENJANG_VALID = ["TPA", "KB", "TK", "SD", "SMP"];

function isValidJenjang(value) {
  var str = String(value || "").trim().toUpperCase();
  return DAFTAR_JENJANG_VALID.indexOf(str) !== -1;
}

// ==================================================
// VALIDASI BERKAS (RUNNING 2)
// ==================================================

var ALLOWED_IMAGE_EXT = ["jpg", "jpeg", "png"];
var ALLOWED_DOC_EXT = ["pdf", "jpg", "jpeg", "png"];

// Batas ukuran file. Bisa disesuaikan jika kuota Apps Script memungkinkan.
var MAX_FOTO_SIZE_BYTES = 1 * 1024 * 1024;  // 1 MB untuk foto 3x4
var MAX_DOC_SIZE_BYTES = 2 * 1024 * 1024;   // 2 MB untuk Akta/KK/KTP

function getFileExtension(filename) {
  var str = String(filename || "");
  var parts = str.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

/**
 * Menghitung perkiraan ukuran byte dari sebuah string base64
 * (tanpa perlu decode penuh), untuk validasi cepat sebelum diproses.
 */
function getBase64SizeBytes(base64Str) {
  if (!base64Str) return 0;
  var len = base64Str.length;
  var padding = 0;
  if (base64Str.charAt(len - 1) === "=") padding++;
  if (base64Str.charAt(len - 2) === "=") padding++;
  return Math.floor((len * 3) / 4) - padding;
}

/**
 * Validasi lengkap payload berkas (foto, tanda tangan, akta, KK, KTP)
 * sebelum diproses & disimpan ke Drive. Semua berkas WAJIB tersedia.
 */
function validateBerkasPayload(payload) {
  var errors = [];

  if (!payload || !payload.foto || !payload.foto.base64) {
    errors.push("Foto anak wajib diunggah.");
  } else {
    var fotoExt = getFileExtension(payload.foto.filename);
    if (ALLOWED_IMAGE_EXT.indexOf(fotoExt) === -1) {
      errors.push("Format foto anak harus JPG, JPEG, atau PNG.");
    }
    if (getBase64SizeBytes(payload.foto.base64) > MAX_FOTO_SIZE_BYTES) {
      errors.push("Ukuran foto anak maksimal 1 MB.");
    }
  }

  if (!payload || !payload.tandaTangan || !payload.tandaTangan.base64) {
    errors.push("Tanda tangan wajib diisi.");
  }

  var dokumenList = [
    { key: "akta", label: "Akta Kelahiran" },
    { key: "kk", label: "Kartu Keluarga" },
    { key: "ktp", label: "KTP Orang Tua" }
  ];

  dokumenList.forEach(function (d) {
    var file = payload ? payload[d.key] : null;
    if (!file || !file.base64) {
      errors.push(d.label + " wajib diunggah.");
      return;
    }
    var ext = getFileExtension(file.filename);
    if (ALLOWED_DOC_EXT.indexOf(ext) === -1) {
      errors.push("Format " + d.label + " harus PDF, JPG, JPEG, atau PNG.");
    }
    if (getBase64SizeBytes(file.base64) > MAX_DOC_SIZE_BYTES) {
      errors.push("Ukuran " + d.label + " maksimal 2 MB.");
    }
  });

  return { valid: errors.length === 0, errors: errors };
}

/**
 * Membersihkan nama agar aman dipakai sebagai nama folder/file di Drive.
 */
function sanitizeName(str) {
  var cleaned = String(str || "").replace(/[\/\\:*?"<>|]/g, "-").trim();
  return cleaned || "Tanpa Nama";
}

// ==================================================
// STATUS KELENGKAPAN SISWA
// ==================================================

/**
 * Menentukan status kelengkapan data siswa berdasarkan payload.
 * Karena RUNNING 1 belum ada upload dokumen, status LENGKAP ditentukan
 * dari kelengkapan field wajib saja (dokumen dicek mulai RUNNING 2).
 */
function computeStatusSiswa(validationResult) {
  return validationResult.valid ? "LENGKAP" : "BELUM LENGKAP";
}

// ==================================================
// KEAMANAN AKSES DASHBOARD (RUNNING 3)
// ==================================================
//
// SEKOLAH login memakai NPSN saja (sesuai spesifikasi), lalu setiap
// pemanggilan API selalu memvalidasi ulang NPSN itu ke sheet `db` dan
// memfilter data hanya milik NPSN tersebut (lihat DashboardBackend.gs).
//
// DINAS & CAPIL login memakai KODE AKSES yang disimpan di
// Project Settings > Script Properties (BUKAN ditulis di kode), supaya
// mudah diganti tanpa deploy ulang dan tidak ikut ter-share bila kode
// dibagikan. Kunci property:
//   DINAS_ACCESS_CODE
//   CAPIL_ACCESS_CODE
//
// Jika property belum diisi, akses ditolak (fail-closed) — lihat
// PANDUAN_TESTING_RUNNING3.md bagian "Konfigurasi yang harus diisi".

function checkAccessCode(propertyKey, inputCode) {
  var configured = PropertiesService.getScriptProperties().getProperty(propertyKey);
  if (!configured || String(configured).trim() === "") {
    return false; // fail-closed: belum dikonfigurasi Admin = akses ditolak
  }
  return String(inputCode || "").trim() === String(configured).trim();
}

function checkDinasAccess(code) {
  return checkAccessCode("DINAS_ACCESS_CODE", code);
}

function checkCapilAccess(code) {
  return checkAccessCode("CAPIL_ACCESS_CODE", code);
}

// ==================================================
// LOGO DINAS
// ==================================================

// RUNNING 3.2: File ID logo kop Dinas diperbarui sesuai link yang diberikan
// (https://drive.google.com/file/d/1ea2uBetAThzFXLGugWhbteg7lMq2ZJ3j/view).
// Dipakai untuk header web app (LogoScript.html) DAN kop surat PDF Formulir KIA.
var LOGO_FILE_ID = "1ea2uBetAThzFXLGugWhbteg7lMq2ZJ3j";

/**
 * Mengambil file logo dari Google Drive berdasarkan File ID yang sudah
 * ditentukan, lalu mengembalikannya sebagai data URI (base64) agar bisa
 * langsung dipasang ke elemen <img id="headerLogoImg"> di frontend.
 * JANGAN mengubah LOGO_FILE_ID.
 */
function getLogoDataUri() {
  try {
    var file = DriveApp.getFileById(LOGO_FILE_ID);
    var blob = file.getBlob();
    var base64 = Utilities.base64Encode(blob.getBytes());
    var mimeType = blob.getContentType();
    return "data:" + mimeType + ";base64," + base64;
  } catch (err) {
    Logger.log("getLogoDataUri error: " + err);
    return null; // frontend akan menampilkan headerLogoFallback
  }
}

/**
 * Mengambil logo Dinas sebagai Blob mentah (BUKAN data URI) — dipakai oleh
 * PDFFormulir.gs untuk ditempel langsung sebagai gambar kop surat PDF.
 * Mengembalikan null jika file logo gagal diambil (PDF tetap dibuat tanpa
 * logo, hanya teks kop surat saja, supaya proses tidak gagal total).
 */
function getLogoBlob() {
  try {
    return DriveApp.getFileById(LOGO_FILE_ID).getBlob();
  } catch (err) {
    Logger.log("getLogoBlob error: " + err);
    return null;
  }
}