/**
 * PdfMerge.gs
 * RUNNING 3.4 — Menggabungkan Formulir KIA + Akta + KK + KTP menjadi SATU
 * file PDF, MEMPERTAHANKAN ukuran & orientasi ASLI tiap halaman (potrait
 * tetap potrait, landscape tetap landscape, tidak ada yang dipotong/diputar
 * paksa) — karena ini PENGGABUNGAN PDF SUNGGUHAN (bukan konversi OCR/Google
 * Docs yang memaksa semua halaman mengikuti ukuran halaman Doc).
 *
 * RIWAYAT PENDEKATAN (dari percobaan sebelumnya, untuk konteks):
 * 1) pdf-lib diunduh dari CDN internet (jsdelivr.net) -> DIBLOKIR kebijakan
 *    domain Google Workspace instansi ini (scope "script.external_request"
 *    ditolak admin) -> gagal total.
 * 2) Drive API (konversi PDF -> Google Docs via OCR) -> BERHASIL berjalan
 *    tanpa internet, TAPI setiap halaman "difoto ulang" mengikuti ukuran
 *    halaman Google Docs (potrait) -> PDF landscape (mis. KK yang di-scan
 *    miring) jadi terpotong/proporsinya berubah. TIDAK sesuai kebutuhan.
 * 3) INI (dipakai sekarang): pdf-lib TETAP dipakai (satu-satunya cara di
 *    Apps Script untuk menggabung PDF ASLI tanpa mengubah ukuran/orientasi
 *    halaman apa pun), TAPI file library-nya dibaca dari GOOGLE DRIVE milik
 *    akun ini sendiri -- BUKAN diunduh dari internet. Jadi TIDAK memerlukan
 *    scope "script.external_request" sama sekali; hanya scope Drive yang
 *    memang sudah dipakai aplikasi ini sejak RUNNING 2.
 *
 * ================= SETUP WAJIB (SEKALI SAJA) =================
 * 1. Di BROWSER (bukan lewat Apps Script), buka:
 *    https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
 *    Klik kanan halaman itu -> "Save As" / "Simpan Sebagai" -> simpan
 *    sebagai file teks, misalnya "pdf-lib.min.js".
 *    (Boleh diunduh dari komputer/HP mana saja, tidak harus dari akun
 *    Google yang menjalankan aplikasi ini.)
 * 2. Upload file tsb ke Google Drive milik akun yang menjalankan aplikasi
 *    ini (folder bebas; boleh taruh di dalam folder "KIA").
 * 3. Buka file itu di Drive, klik kanan -> "Get link" / "Dapatkan link",
 *    salin ID-nya dari URL, contoh:
 *    https://drive.google.com/file/d/  ID_FILE_DI_SINI  /view
 * 4. Isi ID tsb ke variabel PDFLIB_DRIVE_FILE_ID di bawah ini.
 * ================================================================
 */

// GANTI dengan File ID file "pdf-lib.min.js" yang sudah Anda upload ke Drive
// (lihat langkah SETUP WAJIB di atas).
var PDFLIB_DRIVE_FILE_ID = "16vleWgp8fHgLXV4yfg5W1ylHhWhilfAu";

/**
 * Memuat pdf-lib ke variabel global PDFLib, dibaca dari file di Google
 * Drive (BUKAN dari internet). Aman dipanggil berkali-kali (idempotent).
 */
function loadPdfLibIfNeeded_() {
  if (typeof PDFLib !== "undefined") return;

  if (!PDFLIB_DRIVE_FILE_ID || PDFLIB_DRIVE_FILE_ID.indexOf("ISI_DENGAN") === 0) {
    throw new Error(
      "PDFLIB_DRIVE_FILE_ID belum diisi di PdfMerge.gs. Ikuti langkah 'SETUP WAJIB' " +
      "pada komentar di bagian atas file PdfMerge.gs (unduh pdf-lib.min.js lewat browser, " +
      "upload ke Drive, lalu isi File ID-nya)."
    );
  }

  // Apps Script tidak memiliki setTimeout/clearTimeout bawaan. pdf-lib
  // memakainya di beberapa tempat secara internal. Kita sediakan pengganti
  // yang berjalan SEGERA (sinkron), didefinisikan SEBELUM eval() supaya
  // otomatis dipakai lewat pencarian variabel global biasa di JavaScript.
  if (typeof setTimeout === "undefined") {
    globalThis.setTimeout = function (fn, ms) {
      if (ms) { try { Utilities.sleep(ms); } catch (e) { /* abaikan */ } }
      return fn();
    };
  }
  if (typeof clearTimeout === "undefined") {
    globalThis.clearTimeout = function () {};
  }

  var code;
  try {
    code = readPdfLibCodeCached_();
  } catch (eRead) {
    throw new Error(
      "Gagal membaca file pdf-lib dari Drive (File ID: " + PDFLIB_DRIVE_FILE_ID + "). " +
      "Pastikan File ID benar dan filenya masih ada & bisa diakses akun ini. Detail: " + eRead
    );
  }

  eval(code);

  if (typeof PDFLib === "undefined") {
    throw new Error(
      "File berhasil dibaca, tapi variabel global PDFLib tidak ditemukan setelah " +
      "dijalankan. Kemungkinan file yang diupload bukan pdf-lib.min.js yang utuh (terpotong " +
      "saat diunduh/diupload, atau salah file). Coba unduh ulang filenya."
    );
  }
}

// ==================================================
// RUNNING 4 — CACHE pdf-lib.min.js (PERFORMA)
// ==================================================
// SEBELUM: setiap kali mergePdfBlobsAsync_ dipanggil, seluruh isi file
// pdf-lib.min.js (~ratusan KB) dibaca ULANG dari Drive lewat DriveApp, PADAHAL
// tiap eksekusi Apps Script (tiap panggilan google.script.run) berjalan di
// context baru -- jadi ini terjadi di SETIAP proses upload, dan menjadi salah
// satu penyumbang terbesar lamanya waktu tunggu (baca file + eval string
// sebesar itu bisa memakan 1-3 detik sendiri).
//
// SESUDAH: isi file disimpan ke CacheService (cache milik script, bertahan
// s/d 6 jam) dalam beberapa potongan (tiap potongan wajib < 100 KB, batas
// CacheService). Permintaan berikutnya cukup ambil dari cache yang jauh
// lebih cepat dibanding baca file Drive, TANPA perlu mengubah/upload ulang
// file pdf-lib.min.js yang sudah ada.
var PDFLIB_CACHE_PREFIX = "pdflib_v1_chunk_";
var PDFLIB_CACHE_CHUNK_SIZE = 90000; // aman di bawah batas 100 KB per key
var PDFLIB_CACHE_TTL_SECONDS = 21600; // 6 jam = maksimum CacheService

function readPdfLibCodeCached_() {
  var cache = CacheService.getScriptCache();

  try {
    var meta = cache.get(PDFLIB_CACHE_PREFIX + "meta");
    if (meta) {
      var jumlahChunk = parseInt(meta, 10);
      var potongan = [];
      var lengkap = true;
      for (var i = 0; i < jumlahChunk; i++) {
        var c = cache.get(PDFLIB_CACHE_PREFIX + i);
        if (c === null) { lengkap = false; break; }
        potongan.push(c);
      }
      if (lengkap) return potongan.join("");
    }
  } catch (eCacheRead) {
    Logger.log("Cache pdf-lib tidak terbaca (tidak fatal, lanjut ambil dari Drive): " + eCacheRead);
  }

  // Cache kosong/kadaluarsa -> ambil dari Drive (sekali), lalu simpan ke
  // cache supaya permintaan-permintaan BERIKUTNYA (dalam 6 jam ke depan)
  // tidak perlu membaca Drive lagi.
  var code = DriveApp.getFileById(PDFLIB_DRIVE_FILE_ID).getBlob().getDataAsString();

  try {
    var jumlah = Math.ceil(code.length / PDFLIB_CACHE_CHUNK_SIZE);
    var toPut = {};
    for (var j = 0; j < jumlah; j++) {
      toPut[PDFLIB_CACHE_PREFIX + j] = code.substr(j * PDFLIB_CACHE_CHUNK_SIZE, PDFLIB_CACHE_CHUNK_SIZE);
    }
    toPut[PDFLIB_CACHE_PREFIX + "meta"] = String(jumlah);
    cache.putAll(toPut, PDFLIB_CACHE_TTL_SECONDS);
  } catch (eCacheWrite) {
    // Gagal menyimpan ke cache TIDAK BOLEH menggagalkan proses gabung PDF;
    // kita sudah punya `code`-nya, tinggal lanjut pakai itu saja.
    Logger.log("Gagal menyimpan pdf-lib ke cache (tidak fatal): " + eCacheWrite);
  }

  return code;
}

/**
 * Menggabungkan beberapa Blob PDF (urutan array = urutan halaman akhir)
 * menjadi SATU Blob PDF, MEMPERTAHANKAN ukuran & orientasi asli tiap
 * halaman (tidak ada rotasi/pemotongan/pemaksaan ukuran halaman seragam).
 *
 * CATATAN: fungsi ini "async" karena API pdf-lib berbasis Promise. Fungsi
 * PEMANGGIL paling luar yang di-expose ke google.script.run (apiUploadBerkas
 * di Code.gs) JUGA dideklarasikan async supaya Apps Script menunggu seluruh
 * proses ini selesai sebelum mengirim hasil ke frontend.
 *
 * @param {Blob[]} pdfBlobs - array Blob PDF, urutan = urutan halaman akhir.
 * @param {string} outputFileName - nama file PDF hasil gabungan.
 * @param {string} debugLabel - opsional, dipakai untuk mencatat progres detail
 *        ke sheet `log` (Aksi "MERGE_DEBUG") supaya mudah didiagnosis dari
 *        Google Sheet biasa, tanpa perlu buka Apps Script Editor.
 * @return {Blob}
 */
async function mergePdfBlobsAsync_(pdfBlobs, outputFileName, debugLabel) {
  loadPdfLibIfNeeded_();

  function catatDebug(pesan) {
    Logger.log(pesan);
    try { writeLog("MERGE_DEBUG", "", "", debugLabel || outputFileName, pesan); } catch (e) { /* abaikan jika writeLog tidak tersedia */ }
  }

  catatDebug("Mulai gabung " + pdfBlobs.length + " berkas -> " + outputFileName);

  var mergedDoc = await PDFLib.PDFDocument.create();

  for (var i = 0; i < pdfBlobs.length; i++) {
    if (!pdfBlobs[i]) {
      catatDebug("Berkas ke-" + (i + 1) + ": KOSONG (null/undefined) -> DILEWATI.");
      continue;
    }

    var namaFile = "(tanpa nama)";
    var ukuranByte = 0;
    try { namaFile = pdfBlobs[i].getName(); } catch (eName) {}
    try { ukuranByte = pdfBlobs[i].getBytes().length; } catch (eSize) {}
    catatDebug("Berkas ke-" + (i + 1) + " ('" + namaFile + "'): ukuran " + ukuranByte + " byte. Mulai dibaca pdf-lib...");

    if (ukuranByte === 0) {
      catatDebug("Berkas ke-" + (i + 1) + " ('" + namaFile + "'): UKURAN 0 BYTE -- kemungkinan besar file rusak/gagal tersimpan. DILEWATI supaya proses lain tetap lanjut.");
      continue;
    }

    var srcDoc;
    try {
      var bytes = new Uint8Array(pdfBlobs[i].getBytes());
      srcDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (eLoad) {
      throw new Error("Gagal membaca PDF ke-" + (i + 1) + " ('" + namaFile + "') saat proses gabung: " + eLoad);
    }

    var jumlahHalamanSumber = srcDoc.getPageIndices().length;
    catatDebug("Berkas ke-" + (i + 1) + " ('" + namaFile + "'): berhasil dibaca, berisi " + jumlahHalamanSumber + " halaman.");

    // copyPages() menyalin halaman APA ADANYA, termasuk ukuran (MediaBox)
    // dan orientasi asli masing-masing halaman -- inilah yang memastikan
    // KK landscape tetap landscape, Akta potrait tetap potrait, dst.
    var copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    copiedPages.forEach(function (p) { mergedDoc.addPage(p); });

    catatDebug("Berkas ke-" + (i + 1) + " ('" + namaFile + "'): " + copiedPages.length + " halaman berhasil ditambahkan. Total halaman gabungan sejauh ini: " + mergedDoc.getPageCount() + ".");
  }

  var totalHalamanAkhir = mergedDoc.getPageCount();
  catatDebug("SELESAI. Total halaman pada file gabungan akhir: " + totalHalamanAkhir + " (seharusnya 4 kalau semua berkas normal 1 halaman).");

  var mergedBytes = await mergedDoc.save();
  return Utilities.newBlob(Array.from(new Int8Array(mergedBytes)), "application/pdf", outputFileName);
}

/**
 * RUNNING 4 — Menggabungkan berkas (Formulir+Akta+KK+KTP) untuk SATU ID
 * Pengajuan, dipanggil DI LUAR proses upload utama (apiUploadBerkas), baik:
 * 1. Sebagai panggilan LATAR (background) dari client segera setelah upload
 *    inti sukses, TANPA membuat orang tua/sekolah menunggu (lihat
 *    apiGabungkanBerkasLatar di Code.gs & JS.html) -- INI PERUBAHAN UTAMA
 *    yang membuat proses "Kirim Berkas" terasa jauh lebih cepat, karena
 *    penggabungan PDF (bagian paling berat: load pdf-lib + proses 4 file)
 *    tidak lagi menghalangi respons ke pengguna.
 * 2. Sebagai fallback "buat saat dibutuhkan" kalau Dashboard Capil membuka
 *    dokumen gabungan yang keburu belum sempat dibuat proses latar di atas
 *    (lihat apiGetDokumenViewUrl di DashboardBackend.gs).
 *
 * Aman dipanggil berkali-kali: kalau link gabungan SUDAH ada di sheet
 * `dokumen`, fungsi ini langsung mengembalikannya tanpa memproses ulang.
 *
 * @return {String} URL file gabungan (Google Drive).
 */
async function gabungkanBerkasUntukPengajuan_(idPengajuan) {
  var dok = getDokumenByIdPengajuan(idPengajuan);
  if (!dok) {
    throw new Error("Data dokumen untuk ID Pengajuan '" + idPengajuan + "' tidak ditemukan.");
  }
  if (dok.linkGabungan) {
    return dok.linkGabungan; // sudah pernah dibuat, tidak perlu diproses ulang
  }

  var siswa = getSiswaById(idPengajuan);
  if (!siswa) {
    throw new Error("Data siswa untuk ID Pengajuan '" + idPengajuan + "' tidak ditemukan.");
  }

  function ambilBlob(url, label) {
    var id = extractDriveFileId(url);
    if (!id) throw new Error("Link " + label + " kosong/tidak valid, berkas gabungan tidak dapat dibuat.");
    return DriveApp.getFileById(id).getBlob();
  }

  var formulirBlob = ambilBlob(dok.linkFormulir, "Formulir KIA");
  var aktaBlob = ambilBlob(dok.linkAkta, "Akta");
  var kkBlob = ambilBlob(dok.linkKK, "KK");
  var ktpBlob = ambilBlob(dok.linkKTP, "KTP");

  var baseName = siswa.nik + "_" + sanitizeName(siswa.namaAnak);
  var mergedBlob = await mergePdfBlobsAsync_(
    [formulirBlob, aktaBlob, kkBlob, ktpBlob],
    baseName + "_BerkasLengkap.pdf",
    idPengajuan
  );

  var folder = getStudentFolder(siswa.kecamatan, siswa.namaSekolah, siswa.kelasRombel, siswa.namaAnak);
  var mergedFile = folder.createFile(mergedBlob);
  ensureLinkViewableForCapil(mergedFile);

  var url = mergedFile.getUrl();
  updateLinkGabunganDokumen(idPengajuan, url);
  return url;
}

// ==================================================
// FUNGSI DIAGNOSTIK (jalankan manual dari Apps Script Editor)
// ==================================================
/**
 * CARA PAKAI: pilih fungsi ini dari dropdown toolbar Apps Script Editor,
 * klik Run, lalu lihat hasilnya di Execution log.
 */
async function testPdfLibDariDrive() {
  try {
    Logger.log("Mulai memuat pdf-lib dari Drive (File ID: " + PDFLIB_DRIVE_FILE_ID + ")...");
    loadPdfLibIfNeeded_();
    Logger.log("BERHASIL memuat pdf-lib. typeof PDFLib = " + typeof PDFLib);

    Logger.log("Mencoba membuat & menyimpan PDF kosong sebagai uji coba...");
    var doc = await PDFLib.PDFDocument.create();
    doc.addPage([200, 200]);
    var bytes = await doc.save();
    Logger.log("BERHASIL. Ukuran PDF uji coba: " + bytes.length + " byte.");
    Logger.log("KESIMPULAN: pdf-lib berfungsi normal. Jika penggabungan berkas siswa asli masih bermasalah, jalankan testMergeDenganFileAsli() untuk menguji file PDF siswa yang sesungguhnya.");
  } catch (e) {
    Logger.log("GAGAL: " + ((e && e.stack) ? e.stack : e));
  }
}

/**
 * CARA PAKAI: ganti ID_PENGAJUAN_CONTOH dengan ID Pengajuan siswa uji coba
 * Anda (lihat sheet `siswa`/`dokumen`), lalu jalankan seperti fungsi di atas.
 */
async function testMergeDenganFileAsli() {
  var ID_PENGAJUAN_CONTOH = "GANTI_DENGAN_ID_PENGAJUAN_SISWA_UJI_COBA";
  try {
    var dok = getDokumenByIdPengajuan(ID_PENGAJUAN_CONTOH);
    if (!dok) {
      Logger.log("Data dokumen untuk ID Pengajuan '" + ID_PENGAJUAN_CONTOH + "' tidak ditemukan.");
      return;
    }

    function ambilBlob(url, label) {
      var id = extractDriveFileId(url);
      if (!id) { Logger.log(label + ": link kosong/tidak valid, dilewati."); return null; }
      var blob = DriveApp.getFileById(id).getBlob();
      Logger.log(label + ": berhasil diambil, ukuran " + blob.getBytes().length + " byte.");
      return blob;
    }

    var formulirBlob = ambilBlob(dok.linkFormulir, "Formulir");
    var aktaBlob = ambilBlob(dok.linkAkta, "Akta");
    var kkBlob = ambilBlob(dok.linkKK, "KK");
    var ktpBlob = ambilBlob(dok.linkKTP, "KTP");

    Logger.log("Mencoba menggabungkan ke-4 file di atas (mempertahankan orientasi asli tiap halaman)...");
    var merged = await mergePdfBlobsAsync_([formulirBlob, aktaBlob, kkBlob, ktpBlob], "test_gabungan.pdf");
    Logger.log("BERHASIL menggabungkan! Ukuran hasil: " + merged.getBytes().length + " byte.");
  } catch (e) {
    Logger.log("GAGAL menggabungkan file asli. Detail: " + ((e && e.stack) ? e.stack : e));
  }
}