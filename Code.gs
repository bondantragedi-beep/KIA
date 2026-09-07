/**
 * Code.gs
 * Entry point Web App + fungsi backend yang dipanggil dari frontend (google.script.run).
 * APLIKASI PENDATAAN & PENGAJUAN KIA - KOTA MAKASSAR
 *
 * RUNNING 1 SCOPE:
 * - Fondasi aplikasi, database, backend, logo, form orang tua dasar.
 * - BELUM ADA: upload file, signature pad, PDF, dashboard sekolah/dinas/capil, submit sekolah.
 */

/**
 * RUNNING 3: satu Web App yang sama kini melayani 4 halaman berbeda lewat
 * parameter URL ?page=, tanpa mengubah perilaku default (page kosong/ortu
 * tetap membuka form Orang Tua RUNNING 1/2 apa adanya).
 *
 *   ?page=ortu    (default) -> Index.html   : Form Orang Tua
 *   ?page=dinas              -> Dinas.html   : Dashboard Dinas Pendidikan
 *   ?page=capil              -> Capil.html   : Dashboard Capil
 *
 * RUNNING 3.6:
 *   ?page=viewdoc&role=...&code=...&idPengajuan=...&docType=...
 *     -> BUKAN halaman biasa: setelah otorisasi (kode akses + status submit
 *        sekolah) divalidasi PENUH di server lewat resolveDokumenBlob_(),
 *        browser di-REDIRECT langsung ke link Google Drive file PDF-nya.
 *        Dipakai Dashboard Capil (link "Lihat Dokumen") supaya andal untuk
 *        file besar dan tidak memicu kebijakan Chrome Enterprise yang
 *        membatasi skema "blob:" (percobaan sebelumnya yang menyisipkan
 *        seluruh isi file sebagai teks ke HTML terbukti gagal untuk file
 *        besar). Link Drive tujuan TIDAK PERNAH ditampilkan sebelum
 *        otorisasi berhasil.
 *
 * PENTING: parameter `page` hanya menentukan TAMPILAN yang dimuat. Seluruh
 * pembatasan data (siapa boleh lihat apa) TETAP divalidasi ulang di server
 * pada setiap pemanggilan API (lihat DashboardBackend.gs), bukan hanya
 * dengan menyembunyikan halaman ini.
 */
function doGet(e) {
  ensureDatabaseReady();

  var page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page).toLowerCase() : "ortu";

  if (page === "viewdoc") {
    return handleViewDokumenRequest_(e);
  }

  var templateFile = "Index";
  var title = "Pendataan KIA - Kota Makassar";

  if (page === "sekolah") {
    templateFile = "Sekolah";
    title = "Dashboard Sekolah - KIA Kota Makassar";
  } else if (page === "dinas") {
    templateFile = "Dinas";
    title = "Dashboard Dinas Pendidikan - KIA Kota Makassar";
  } else if (page === "capil") {
    templateFile = "Capil";
    title = "Dashboard Capil - KIA Kota Makassar";
  }

  var template = HtmlService.createTemplateFromFile(templateFile);
  return template.evaluate()
    .setTitle(title)
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Menangani ?page=viewdoc -- memvalidasi otorisasi lewat resolveDokumenBlob_()
 * (fungsi yang SAMA dipakai apiGetDokumenFile, lihat DashboardBackend.gs),
 * lalu me-REDIRECT browser langsung ke link Google Drive file tsb (BUKAN
 * mengirim isi filenya lewat HTML kita sendiri -- terbukti gagal/blank
 * untuk file besar, lihat komentar htmlRedirect_ & ensureLinkViewableForCapil).
 *
 * Kalau otorisasi gagal, mengembalikan halaman HTML singkat berisi pesan
 * error (bukan redirect), supaya pengguna tetap tahu alasannya.
 */
function handleViewDokumenRequest_(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  var role = p.role;
  var credential = p.code;
  var idPengajuan = p.idPengajuan;
  var docType = p.docType || "gabungan";

  try {
    if (!role || !credential || !idPengajuan) {
      return htmlPesanAkses_("Permintaan tidak lengkap (role/kode/ID Pengajuan kosong).");
    }

    var hasil = resolveDokumenBlob_(role, credential, idPengajuan, docType);
    if (!hasil.authorized) {
      return htmlPesanAkses_(hasil.message);
    }

    // RUNNING 3.6: PENTING -- doGet() TIDAK BOLEH mengembalikan Blob mentah
    // (Apps Script hanya mendukung HtmlOutput/TextOutput), dan menyisipkan
    // SELURUH isi file besar sebagai "data:" URI langsung ke HTML ternyata
    // melebihi batas yang sanggup ditangani sandboxing Apps Script untuk
    // file berukuran besar (halaman jadi blank tanpa pesan error apa pun).
    // Solusi yang terbukti andal: REDIRECT langsung ke link Google Drive
    // file-nya (file gabungan ini sudah diset "siapa saja dengan link boleh
    // lihat" khusus untuknya -- lihat ensureLinkViewableForCapil di
    // Drive.gs -- link Drive-nya TIDAK PERNAH ditampilkan sebelum otorisasi
    // di atas berhasil).
    var driveViewUrl = "https://drive.google.com/file/d/" + hasil.fileId + "/view";
    return htmlRedirect_(driveViewUrl);
  } catch (err) {
    writeLog("ERROR_VIEWDOC_LINK", "", "", idPengajuan, String(err));
    return htmlPesanAkses_("Terjadi kesalahan sistem: " + err.message);
  }
}

/**
 * Halaman pengalih (redirect) sangat ringan ke URL Google Drive tujuan.
 * Dipakai supaya browser Capil langsung berpindah ke halaman preview PDF
 * asli dari Drive (yang jauh lebih andal untuk file besar dibanding
 * menyisipkan seluruh isinya ke HTML kita sendiri).
 */
function htmlRedirect_(targetUrl) {
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<meta http-equiv="refresh" content="0; url=' + targetUrl + '">' +
    '<script>window.top.location.href = ' + JSON.stringify(targetUrl) + ';</script>' +
    '</head><body style="font-family:sans-serif;padding:24px;">' +
    'Membuka dokumen... Jika tidak otomatis berpindah, ' +
    '<a target="_top" href="' + targetUrl + '">klik di sini</a>.' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle("Membuka Dokumen...");
}

/**
 * Halaman HTML sederhana untuk menampilkan pesan error akses/dokumen,
 * dipakai saat link ?page=viewdoc gagal divalidasi.
 */
function htmlPesanAkses_(pesan) {
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font-family:sans-serif;background:#f5f7fa;padding:32px;color:#1e293b;}' +
    '.box{max-width:480px;margin:40px auto;background:#fff;border:1px solid #fecaca;' +
    'border-left:6px solid #dc2626;border-radius:10px;padding:20px 24px;}' +
    'h3{margin-top:0;color:#b91c1c;}</style></head><body>' +
    '<div class="box"><h3>Tidak Bisa Menampilkan Dokumen</h3><p>' +
    escapeHtmlServer_(pesan) + '</p></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle("Akses Dokumen Ditolak");
}

function escapeHtmlServer_(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/**
 * Helper untuk menyisipkan file HTML lain (CSS.html, JS.html, LogoScript.html)
 * ke dalam Index.html menggunakan <?!= include('NamaFile'); ?>
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ==================================================
// FUNGSI DIPANGGIL DARI FRONTEND (JS.html)
// ==================================================

/**
 * Validasi NPSN dan mengembalikan data sekolah jika ditemukan.
 * Response: { found: true, data: {...} } atau { found: false }
 */
function apiCariSekolah(npsn) {
  // Validasi format inline (tidak bergantung ke Utils.gs) agar fungsi ini
  // tetap berjalan walau Utils.gs belum/terlambat termuat.
  var npsnStr = npsn === null || npsn === undefined ? "" : String(npsn).trim();
  if (!npsnStr || !/^\d{6,10}$/.test(npsnStr)) {
    return { found: false, message: "Format NPSN tidak valid." };
  }
  npsn = npsnStr;

  var sekolah = findSchoolByNPSN(npsn);
  if (!sekolah) {
    writeLog("CARI_NPSN_GAGAL", npsn, "", "", "NPSN tidak ditemukan");
    return { found: false, message: "NPSN tidak ditemukan." };
  }

  writeLog("CARI_NPSN_SUKSES", npsn, "", "", sekolah.namaSekolah);
  // RUNNING 3: beri tahu orang tua SEJAK AWAL jika sekolah sudah SUDAH SUBMIT
  // (data terkunci), supaya tidak perlu mengisi seluruh form dulu baru ditolak.
  // Penolakan SEBENARNYA tetap divalidasi ulang di apiSimpanSiswa/apiUploadBerkas.
  return { found: true, data: sekolah, sudahSubmit: isSekolahLocked(sekolah.npsn) };
}

/**
 * Menyimpan data siswa baru ke sheet `siswa`, dengan validasi backend
 * dan pengecekan duplikasi NIK.
 * Response: { success: true, idPengajuan, status } atau { success: false, errors: [...] }
 */
function apiSimpanSiswa(formData) {
  try {
    var validation = validateSiswaPayload(formData);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Pastikan sekolah valid (jangan percaya data dari client mentah-mentah)
    var sekolah = findSchoolByNPSN(formData.npsn);
    if (!sekolah) {
      return { success: false, errors: ["NPSN tidak valid / tidak ditemukan."] };
    }

    // RUNNING 3: data yang sudah SUDAH SUBMIT ke Dinas terkunci total —
    // orang tua tidak dapat lagi menambah/mengubah data siswa sekolah ini.
    if (isSekolahLocked(sekolah.npsn)) {
      return { success: false, errors: ["Sekolah ini sudah mengirim (submit) data ke Dinas Kependudukan dan Pencatatan Sipil. Pengajuan baru tidak dapat dilakukan lagi."] };
    }

    if (isNIKAlreadyRegistered(formData.nik)) {
      return { success: false, errors: ["NIK ini sudah terdaftar sebelumnya. Data siswa tidak boleh ganda."] };
    }

    // Lengkapi data otomatis dari sekolah (bukan dari client) agar konsisten
    var dataToSave = {
      npsn: sekolah.npsn,
      namaSekolah: sekolah.namaSekolah,
      kecamatan: sekolah.kecamatan,
      desa: sekolah.desa,
      jenjang: formData.jenjang,
      kelasRombel: formData.kelasRombel,
      namaAnak: formData.namaAnak,
      nomorAkta: formData.nomorAkta,
      nik: formData.nik,
      tempatLahir: formData.tempatLahir,
      tanggalLahir: formData.tanggalLahir,
      jenisKelamin: formData.jenisKelamin,
      alamatTinggal: formData.alamatTinggal,
      namaKepalaKeluarga: formData.namaKepalaKeluarga,
      nomorKK: formData.nomorKK,
      namaAyah: formData.namaAyah,
      namaIbu: formData.namaIbu,
      namaPelapor: formData.namaPelapor,
      nomorHpPelapor: formData.nomorHpPelapor
    };

    // RUNNING 2: status "LENGKAP" penuh baru ditetapkan setelah berkas
    // (foto, tanda tangan, akta, KK, KTP) juga selesai diunggah lewat
    // apiUploadBerkas(). Di titik ini data sudah valid tapi berkas belum ada.
    var statusSiswa = "BELUM LENGKAP";
    var idPengajuan = insertSiswa(dataToSave, statusSiswa);

    updateStatusSekolah(sekolah.npsn, sekolah.namaSekolah);
    writeLog("SIMPAN_SISWA", sekolah.npsn, formData.nik, idPengajuan, "Status: " + statusSiswa);

    return { success: true, idPengajuan: idPengajuan, status: statusSiswa };
  } catch (err) {
    writeLog("ERROR_SIMPAN_SISWA", formData ? formData.npsn : "", formData ? formData.nik : "", "", String(err));
    return { success: false, errors: ["Terjadi kesalahan sistem: " + err.message] };
  }
}

/**
 * Mengambil logo Dinas dalam bentuk data URI untuk ditampilkan di header.
 */
function apiGetLogo() {
  return getLogoDataUri();
}

// ==================================================
// RUNNING 2 — UPLOAD BERKAS, TANDA TANGAN, & PEMBUATAN PDF FORMULIR
// ==================================================

/**
 * Menerima seluruh berkas (foto, tanda tangan, akta, KK, KTP) untuk satu
 * ID Pengajuan yang sudah tersimpan datanya (lewat apiSimpanSiswa), lalu:
 * 1. Validasi keberadaan, format, dan ukuran tiap berkas.
 * 2. Menyimpan berkas ke folder Drive: KIA/Kecamatan/Sekolah/Kelas/NamaSiswa
 * 3. Membuat PDF Formulir KIA otomatis (berisi foto & tanda tangan).
 * 4. RUNNING 3.4: Menggabungkan Formulir+Akta+KK+KTP menjadi 1 file PDF
 *    (khusus tampilan Dashboard Capil) memakai pdf-lib yang dibaca dari
 *    Drive (BUKAN internet) — lihat PdfMerge.gs. Ukuran & orientasi asli
 *    tiap halaman dipertahankan (KK landscape tetap landscape, dst).
 * 5. Mencatat seluruh link ke sheet `dokumen`.
 * 6. Mengubah status siswa menjadi LENGKAP dan memperbarui status sekolah.
 *
 * payload = {
 *   idPengajuan: string,
 *   foto:        { base64, mimeType, filename },
 *   tandaTangan: { base64 },                 // selalu PNG dari canvas
 *   akta:        { base64, mimeType, filename },
 *   kk:          { base64, mimeType, filename },
 *   ktp:         { base64, mimeType, filename }
 * }
 *
 * CATATAN TEKNIS: fungsi ini dideklarasikan ASYNC karena proses gabung-PDF
 * (mergePdfBlobsAsync_ di PdfMerge.gs) memakai library pdf-lib yang berbasis
 * Promise. Apps Script (V8 runtime) menunggu seluruh proses async selesai
 * sebelum mengirim hasil ke frontend lewat google.script.run.
 */
async function apiUploadBerkas(payload) {
  try {
    if (!payload || !payload.idPengajuan) {
      return { success: false, errors: ["ID Pengajuan tidak valid."] };
    }

    var siswa = getSiswaById(payload.idPengajuan);
    if (!siswa) {
      return { success: false, errors: ["Data siswa untuk ID Pengajuan ini tidak ditemukan. Pastikan Langkah 3 (Data Siswa) sudah disimpan terlebih dahulu."] };
    }

    // RUNNING 3: berkas tidak dapat diunggah/diubah lagi setelah sekolah SUDAH SUBMIT.
    if (isSekolahLocked(siswa.npsn)) {
      return { success: false, errors: ["Sekolah ini sudah mengirim (submit) data ke Dinas. Berkas tidak dapat diubah lagi."] };
    }

    var validation = validateBerkasPayload(payload);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    var namaSiswa = siswa.namaAnak;
    var nik = siswa.nik;
    var baseName = nik + "_" + sanitizeName(namaSiswa);

    var folder = getStudentFolder(siswa.kecamatan, siswa.namaSekolah, siswa.kelasRombel, namaSiswa);

    // ---------- FOTO ----------
    var fotoExt = getFileExtension(payload.foto.filename) || "jpg";
    var fotoMime = payload.foto.mimeType || ("image/" + (fotoExt === "jpg" ? "jpeg" : fotoExt));
    var fotoFile = saveBase64AsFile(folder, payload.foto.base64, fotoMime, baseName + "_Foto." + fotoExt);

    // ---------- TANDA TANGAN (PNG transparan) ----------
    var ttdFile = saveBase64AsFile(folder, payload.tandaTangan.base64, "image/png", baseName + "_TandaTangan.png");

    // ---------- DOKUMEN: Akta, KK, KTP -> selalu disimpan sebagai PDF ----------
    var aktaFile = saveDocumentAsPdf(folder, payload.akta, baseName + "_Akta");
    var kkFile = saveDocumentAsPdf(folder, payload.kk, baseName + "_KK");
    var ktpFile = saveDocumentAsPdf(folder, payload.ktp, baseName + "_KTP");

    // ---------- FORMULIR KIA (PDF otomatis, pakai foto & ttd yang baru disimpan) ----------
    var formulirBlob = generateFormulirKiaPdf(siswa, fotoFile.getBlob(), ttdFile.getBlob(), baseName + "_FormulirKIA");
    var formulirFile = folder.createFile(formulirBlob);
    ensurePrivate(formulirFile);

    // ---------- RUNNING 3.4: GABUNGKAN 4 PDF JADI 1 FILE UNTUK DASHBOARD CAPIL ----------
    // Urutan sesuai permintaan: Formulir KIA -> Akta -> KK -> KTP.
    // Orientasi & ukuran asli tiap halaman TIDAK diubah (lihat PdfMerge.gs).
    var linkGabungan = "";
    try {
      var mergedBlob = await mergePdfBlobsAsync_(
        [formulirBlob, aktaFile.getBlob(), kkFile.getBlob(), ktpFile.getBlob()],
        baseName + "_BerkasLengkap.pdf",
        siswa.idPengajuan
      );
      var mergedFile = folder.createFile(mergedBlob);
      // RUNNING 3.6: file gabungan diset "siapa saja yang punya link boleh
      // lihat" (BUKAN private) -- lihat penjelasan lengkap & trade-off
      // keamanannya di komentar fungsi ensureLinkViewableForCapil (Drive.gs).
      ensureLinkViewableForCapil(mergedFile);
      linkGabungan = mergedFile.getUrl();
    } catch (mergeErr) {
      // JANGAN gagalkan seluruh proses upload hanya karena penggabungan PDF
      // gagal (mis. PDFLIB_DRIVE_FILE_ID belum diisi/salah). 4 dokumen
      // terpisah tetap tersimpan seperti biasa; hanya file gabungan yang
      // kosong. Detail LENGKAP dicatat ke log agar mudah didiagnosis.
      var detailError = (mergeErr && mergeErr.stack) ? String(mergeErr.stack) : String(mergeErr);
      writeLog("ERROR_GABUNG_PDF", siswa.npsn, nik, siswa.idPengajuan, detailError);
    }

    // ---------- CATAT KE SHEET `dokumen` ----------
    upsertDokumen({
      idPengajuan: siswa.idPengajuan,
      nik: nik,
      npsn: siswa.npsn,
      namaSiswa: namaSiswa,
      linkFoto: fotoFile.getUrl(),
      linkTtd: ttdFile.getUrl(),
      linkFormulir: formulirFile.getUrl(),
      linkAkta: aktaFile.getUrl(),
      linkKK: kkFile.getUrl(),
      linkKTP: ktpFile.getUrl(),
      statusDokumen: "LENGKAP",
      linkGabungan: linkGabungan
    });

    // ---------- UPDATE STATUS SISWA & STATUS SEKOLAH ----------
    updateStatusSiswaByRowIndex(siswa._rowIndex, "LENGKAP");
    updateStatusSekolah(siswa.npsn, siswa.namaSekolah);

    writeLog("UPLOAD_BERKAS", siswa.npsn, nik, siswa.idPengajuan, "Berkas & Formulir KIA berhasil dibuat");

    // PDF formulir dikembalikan sebagai base64 agar orang tua bisa langsung
    // mengunduhnya dari browser TANPA perlu akses ke link Drive (lihat
    // catatan keamanan: file Drive disetel PRIVATE, bukan "anyone with link").
    var formulirBase64 = Utilities.base64Encode(formulirBlob.getBytes());

    return {
      success: true,
      idPengajuan: siswa.idPengajuan,
      statusSiswa: "LENGKAP",
      statusDokumen: "LENGKAP",
      formulirBase64: formulirBase64,
      formulirFileName: baseName + "_FormulirKIA.pdf"
    };

  } catch (err) {
    writeLog("ERROR_UPLOAD_BERKAS", "", "", payload ? payload.idPengajuan : "", String(err));
    return { success: false, errors: ["Terjadi kesalahan sistem: " + err.message] };
  }
}