/**
 * DashboardBackend.gs
 * RUNNING 3 — API backend untuk Dashboard Sekolah, Dashboard Dinas Pendidikan,
 * dan Dashboard Capil, beserta konfirmasi submit sekolah.
 *
 * PRINSIP KEAMANAN UTAMA (WAJIB DIBACA):
 * - Setiap fungsi apiXxx() di file ini memvalidasi ULANG kredensial (NPSN
 *   untuk Sekolah, kode akses untuk Dinas/Capil) pada SETIAP pemanggilan.
 *   Frontend TIDAK menyimpan sesi yang dipercaya begitu saja — walau
 *   tampilan (Sekolah.html/Dinas.html/Capil.html) sudah lolos "login" di
 *   sisi klien, data sungguhan hanya keluar jika server memvalidasi ulang.
 * - Dashboard Capil TIDAK PERNAH mengembalikan data siswa dari sekolah yang
 *   belum berstatus SUDAH SUBMIT — penyaringan dilakukan di server
 *   (getAllSiswaRows() difilter memakai daftar NPSN yang sudah submit),
 *   BUKAN dengan menyembunyikan baris tabel lewat JavaScript di frontend.
 */

// ==================================================
// A. DASHBOARD SEKOLAH
// ==================================================

/**
 * "Login" sekolah: validasi NPSN ke sheet `db`, kembalikan info dasar.
 */
function apiSekolahLogin(npsn) {
  var sekolah = findSchoolByNPSN(npsn);
  if (!sekolah) {
    return { success: false, message: "NPSN tidak ditemukan." };
  }
  return { success: true, sekolah: sekolah };
}

/**
 * Ringkasan + daftar siswa untuk SATU sekolah (NPSN divalidasi ulang di sini,
 * tidak dipercaya dari sesi klien). Opsional filter kelasRombel.
 */
function apiGetSekolahDashboard(npsn, filterKelasRombel) {
  var sekolah = findSchoolByNPSN(npsn);
  if (!sekolah) {
    return { success: false, message: "NPSN tidak ditemukan." };
  }

  var semuaSiswa = getSiswaListByNPSN(sekolah.npsn);
  var statusSekolah = getStatusSekolahByNPSN(sekolah.npsn);

  var totalSiswa = semuaSiswa.length;
  var lengkap = semuaSiswa.filter(function (s) { return s.statusSiswa === "LENGKAP"; }).length;
  var belumLengkap = totalSiswa - lengkap;

  var daftarKelasRombel = uniqueSorted(semuaSiswa.map(function (s) { return s.kelasRombel; }));

  var siswaTampil = semuaSiswa;
  if (filterKelasRombel) {
    siswaTampil = siswaTampil.filter(function (s) { return s.kelasRombel === filterKelasRombel; });
  }

  // Ambil status dokumen per siswa (untuk kolom "Status Dokumen" di tabel)
  var tabel = siswaTampil.map(function (s) {
    var dok = getDokumenByIdPengajuan(s.idPengajuan);
    return {
      idPengajuan: s.idPengajuan,
      namaAnak: s.namaAnak,
      nik: s.nik,
      jenjang: s.jenjang,
      kelasRombel: s.kelasRombel,
      statusSiswa: s.statusSiswa,
      statusDokumen: dok ? dok.statusDokumen : "BELUM ADA",
      adaDokumen: !!dok
    };
  });

  var statusSekolahLabel = statusSekolah ? statusSekolah.status : "BELUM MENGISI";
  var sudahSubmit = statusSekolahLabel === "SUDAH SUBMIT";
  var siapSubmit = totalSiswa > 0 && belumLengkap === 0 && !sudahSubmit;

  return {
    success: true,
    sekolah: sekolah,
    ringkasan: {
      totalSiswa: totalSiswa,
      sudahMengisi: totalSiswa, // setiap baris di sheet `siswa` = sudah mengisi minimal data dasar
      belumMengisi: 0,          // RUNNING 3 tidak melacak siswa yang belum mulai mengisi sama sekali (tanpa data)
      dataLengkap: lengkap,
      dataBelumLengkap: belumLengkap,
      statusSekolah: statusSekolahLabel,
      timestampSubmit: statusSekolah ? statusSekolah.timestampSubmit : "",
      disubmitOleh: statusSekolah ? statusSekolah.disubmitOleh : ""
    },
    daftarKelasRombel: daftarKelasRombel,
    siswa: tabel,
    sudahSubmit: sudahSubmit,
    siapSubmit: siapSubmit
  };
}

/**
 * Konfirmasi & kirim data sekolah ke Dinas (submit final).
 * Server memvalidasi ULANG bahwa:
 * 1. NPSN valid.
 * 2. Sekolah belum pernah submit sebelumnya (tidak bisa submit ulang).
 * 3. SELURUH siswa sekolah ini berstatus LENGKAP (data + dokumen).
 * 4. Checkbox persetujuan dicentang.
 */
function apiSekolahSubmit(npsn, setuju, namaPenandatangan) {
  try {
    var sekolah = findSchoolByNPSN(npsn);
    if (!sekolah) {
      return { success: false, message: "NPSN tidak ditemukan." };
    }

    if (isSekolahLocked(sekolah.npsn)) {
      return { success: false, message: "Sekolah ini sudah SUDAH SUBMIT sebelumnya dan tidak dapat submit ulang." };
    }

    if (!setuju) {
      return { success: false, message: "Anda wajib menyetujui pernyataan konfirmasi terlebih dahulu." };
    }

    var semuaSiswa = getSiswaListByNPSN(sekolah.npsn);
    if (semuaSiswa.length === 0) {
      return { success: false, message: "Belum ada data siswa yang diajukan untuk sekolah ini." };
    }

    var belumLengkap = semuaSiswa.filter(function (s) { return s.statusSiswa !== "LENGKAP"; });
    if (belumLengkap.length > 0) {
      return {
        success: false,
        message: "Masih ada " + belumLengkap.length + " siswa dengan data/dokumen belum lengkap. Lengkapi seluruhnya sebelum submit."
      };
    }

    var submittedBy = (namaPenandatangan && String(namaPenandatangan).trim())
      ? String(namaPenandatangan).trim()
      : "Operator Sekolah (" + sekolah.npsn + ")";

    updateStatusSekolahSubmit(sekolah.npsn, submittedBy);
    writeLog("SEKOLAH_SUBMIT", sekolah.npsn, "", "", "Disubmit oleh: " + submittedBy);

    return { success: true, message: "Data sekolah berhasil dikirim ke Dinas Kependudukan dan Pencatatan Sipil." };
  } catch (err) {
    writeLog("ERROR_SEKOLAH_SUBMIT", npsn, "", "", String(err));
    return { success: false, message: "Terjadi kesalahan sistem: " + err.message };
  }
}

// ==================================================
// B. DASHBOARD DINAS PENDIDIKAN
// ==================================================

/**
 * Login Dinas: hanya kode akses (dari Script Properties), TIDAK ada bypass.
 */
function apiDinasLogin(code) {
  if (!checkDinasAccess(code)) {
    return { success: false, message: "Kode akses Dinas salah atau belum dikonfigurasi Admin." };
  }
  return { success: true };
}

/**
 * Ringkasan seluruh sekolah + tabel progres, dengan filter opsional.
 * filters = { kecamatan, desa, jenjang, statusPengisian, statusSubmit }
 */
function apiGetDinasOverview(code, filters) {
  if (!checkDinasAccess(code)) {
    return { success: false, message: "Akses ditolak. Kode akses Dinas tidak valid." };
  }
  filters = filters || {};

  var semuaSekolahDb = getAllSchoolsBasicInfo();           // SELURUH sekolah terdaftar di sheet `db`
  var statusByNpsn = {};
  getAllStatusSekolahRows().forEach(function (r) { statusByNpsn[r.npsn] = r; });
  var semuaSiswa = getAllSiswaRows();

  // Gabungkan (LEFT JOIN) sekolah db dengan status_sekolah: sekolah yang
  // belum punya baris status_sekolah dianggap BELUM MENGISI (0 siswa).
  var gabungan = semuaSekolahDb.map(function (sekolahInfo) {
    var r = statusByNpsn[sekolahInfo.npsn];
    return {
      npsn: sekolahInfo.npsn,
      namaSekolah: sekolahInfo.namaSekolah,
      kecamatan: sekolahInfo.kecamatan,
      desa: sekolahInfo.desa,
      bentukPendidikan: sekolahInfo.bentukPendidikan,
      jumlahSiswa: r ? r.jumlahSiswa : 0,
      jumlahLengkap: r ? r.jumlahLengkap : 0,
      status: r ? r.status : "BELUM MENGISI"
    };
  });

  var totalSekolahTerdaftar = gabungan.length;
  var belumMengisi = gabungan.filter(function (r) { return r.status === "BELUM MENGISI"; }).length;
  var sedangMengisi = gabungan.filter(function (r) { return r.status === "SEDANG MENGISI"; }).length;
  var siapSubmit = gabungan.filter(function (r) {
    return r.status === "SEDANG MENGISI" && r.jumlahSiswa > 0 && r.jumlahSiswa === r.jumlahLengkap;
  }).length;
  var sudahSubmit = gabungan.filter(function (r) { return r.status === "SUDAH SUBMIT"; }).length;

  var totalSiswa = semuaSiswa.length;

  var persenSekolahMengisi = totalSekolahTerdaftar > 0 ? round1(((totalSekolahTerdaftar - belumMengisi) / totalSekolahTerdaftar) * 100) : 0;
  var persenSekolahSubmit = totalSekolahTerdaftar > 0 ? round1((sudahSubmit / totalSekolahTerdaftar) * 100) : 0;

  // Tabel progres per sekolah (dengan filter)
  var tabel = gabungan.map(function (r) {
    return {
      npsn: r.npsn,
      namaSekolah: r.namaSekolah,
      kecamatan: r.kecamatan || "-",
      desa: r.desa || "-",
      bentukPendidikan: r.bentukPendidikan || "-",
      jumlahSiswa: r.jumlahSiswa,
      sudahMengisi: r.jumlahSiswa, // setiap baris siswa dianggap "sudah mengisi"
      belumMengisi: 0,
      status: r.status
    };
  });

  if (filters.kecamatan) {
    tabel = tabel.filter(function (r) { return r.kecamatan === filters.kecamatan; });
  }
  if (filters.desa) {
    tabel = tabel.filter(function (r) { return r.desa === filters.desa; });
  }
  if (filters.jenjang) {
    // Jenjang ada pada level siswa, bukan sekolah -> sekolah ikut tampil jika
    // punya minimal 1 siswa pada jenjang tsb.
    var npsnDenganJenjang = {};
    semuaSiswa.forEach(function (s) {
      if (s.jenjang === filters.jenjang) npsnDenganJenjang[s.npsn] = true;
    });
    tabel = tabel.filter(function (r) { return !!npsnDenganJenjang[r.npsn]; });
  }
  if (filters.statusSubmit) {
    tabel = tabel.filter(function (r) { return r.status === filters.statusSubmit; });
  }

  var daftarKecamatan = uniqueSorted(getAllSchoolsBasicInfo().map(function (s) { return s.kecamatan; }));
  var daftarDesa = uniqueSorted(getAllSchoolsBasicInfo().map(function (s) { return s.desa; }));
  var daftarJenjang = DAFTAR_JENJANG_VALID; // TPA, KB, TK, SD, SMP (lihat Utils.gs)

  return {
    success: true,
    ringkasan: {
      totalSekolahTerdaftar: totalSekolahTerdaftar,
      belumMengisi: belumMengisi,
      sedangMengisi: sedangMengisi,
      siapSubmit: siapSubmit,
      sudahSubmit: sudahSubmit,
      totalSiswa: totalSiswa,
      totalSiswaSudahMengisi: totalSiswa,
      persenSekolahMengisi: persenSekolahMengisi,
      persenSekolahSubmit: persenSekolahSubmit
    },
    filterOptions: {
      kecamatan: daftarKecamatan,
      desa: daftarDesa,
      jenjang: daftarJenjang,
      statusSubmit: ["BELUM MENGISI", "SEDANG MENGISI", "SUDAH SUBMIT"]
    },
    tabel: tabel
  };
}

// ==================================================
// C. DASHBOARD CAPIL
// ==================================================
//
// ATURAN PALING PENTING: Capil HANYA boleh melihat siswa dari sekolah yang
// berstatus SUDAH SUBMIT. Penyaringan terjadi di sini (server), memakai
// daftar whitelist NPSN yang sudah submit — bukan filter di frontend.

function apiCapilLogin(code) {
  if (!checkCapilAccess(code)) {
    return { success: false, message: "Kode akses Capil salah atau belum dikonfigurasi Admin." };
  }
  return { success: true };
}

/**
 * Mengembalikan daftar NPSN yang statusnya SUDAH SUBMIT. Fungsi internal,
 * dipakai untuk menyaring seluruh data yang boleh dilihat Capil.
 */
function getNPSNSudahSubmit() {
  return getAllStatusSekolahRows()
    .filter(function (r) { return r.status === "SUDAH SUBMIT"; })
    .map(function (r) { return r.npsn; });
}

function apiGetCapilOverview(code) {
  if (!checkCapilAccess(code)) {
    return { success: false, message: "Akses ditolak. Kode akses Capil tidak valid." };
  }

  var npsnSubmit = getNPSNSudahSubmit();
  var npsnSubmitSet = arrayToSet(npsnSubmit);

  var semuaSiswa = getAllSiswaRows().filter(function (s) { return npsnSubmitSet[s.npsn]; });
  var statusRows = getAllStatusSekolahRows().filter(function (r) { return r.status === "SUDAH SUBMIT"; });

  return {
    success: true,
    ringkasan: {
      totalSekolahSubmit: statusRows.length,
      totalSiswa: semuaSiswa.length
    }
  };
}

/**
 * Daftar siswa untuk Capil, HANYA dari sekolah SUDAH SUBMIT.
 * filters = { kecamatan, desa, npsn, jenjang, kelasRombel }
 */
function apiGetCapilSiswaList(code, filters) {
  if (!checkCapilAccess(code)) {
    return { success: false, message: "Akses ditolak. Kode akses Capil tidak valid." };
  }
  filters = filters || {};

  var npsnSubmitSet = arrayToSet(getNPSNSudahSubmit());

  // Penyaringan utama & TERPENTING: buang seluruh siswa yang NPSN sekolahnya
  // belum ada di whitelist "sudah submit", SEBELUM data ini dikirim ke client.
  var siswaBolehDilihat = getAllSiswaRows().filter(function (s) { return npsnSubmitSet[s.npsn]; });

  if (filters.npsn) {
    siswaBolehDilihat = siswaBolehDilihat.filter(function (s) { return s.npsn === filters.npsn; });
  }
  if (filters.kecamatan) {
    siswaBolehDilihat = siswaBolehDilihat.filter(function (s) { return s.kecamatan === filters.kecamatan; });
  }
  if (filters.desa) {
    siswaBolehDilihat = siswaBolehDilihat.filter(function (s) { return s.desa === filters.desa; });
  }
  if (filters.jenjang) {
    siswaBolehDilihat = siswaBolehDilihat.filter(function (s) { return s.jenjang === filters.jenjang; });
  }
  if (filters.kelasRombel) {
    siswaBolehDilihat = siswaBolehDilihat.filter(function (s) { return s.kelasRombel === filters.kelasRombel; });
  }

  var sekolahList = getAllSchoolsBasicInfo();
  var sekolahSubmitList = sekolahList.filter(function (s) { return npsnSubmitSet[s.npsn]; });

  var tabel = siswaBolehDilihat.map(function (s) {
    return {
      idPengajuan: s.idPengajuan,
      npsn: s.npsn,
      namaSekolah: s.namaSekolah,
      kecamatan: s.kecamatan,
      desa: s.desa,
      jenjang: s.jenjang,
      kelasRombel: s.kelasRombel,
      namaAnak: s.namaAnak,
      nik: s.nik
    };
  });

  return {
    success: true,
    tabel: tabel,
    filterOptions: {
      kecamatan: uniqueSorted(sekolahSubmitList.map(function (s) { return s.kecamatan; })),
      desa: uniqueSorted(sekolahSubmitList.map(function (s) { return s.desa; })),
      sekolah: sekolahSubmitList.map(function (s) { return { npsn: s.npsn, namaSekolah: s.namaSekolah }; }),
      jenjang: DAFTAR_JENJANG_VALID, // TPA, KB, TK, SD, SMP (lihat Utils.gs)
      kelasRombel: uniqueSorted(siswaBolehDilihat.map(function (s) { return s.kelasRombel; }))
    }
  };
}

// ==================================================
// D. LIHAT DOKUMEN (dipakai bersama oleh Sekolah, Dinas, Capil)
// ==================================================
//
// Dokumen TIDAK PERNAH dikirim lewat link Drive mentah ke client — file
// selalu diambil ulang di server (base64) SETELAH otorisasi peran & data
// divalidasi, sesuai jenis dokumen yang diminta.

/**
 * RUNNING 3.6: logika inti OTORISASI (tanpa mengambil isi file) dipisah
 * sendiri, dipakai oleh:
 * 1. resolveDokumenBlob_() - menambahkan pengambilan Blob di atasnya,
 *    dipakai apiGetDokumenFile() (cara lama, base64, dipakai Sekolah).
 * 2. apiGetDokumenViewUrl() - HANYA mengembalikan link Drive-nya (TANPA
 *    mengunduh isi file sama sekali, jadi cepat & ringan), dipakai Capil.
 *
 * @return {Object} { authorized, message, fileId, fileName }
 */
function resolveDokumenAccess_(role, credential, idPengajuan, docType) {
  var siswa = getSiswaById(idPengajuan);
  if (!siswa) {
    return { authorized: false, message: "Data siswa tidak ditemukan." };
  }

  var authorized = false;
  if (role === "sekolah") {
    var sekolah = findSchoolByNPSN(credential);
    authorized = !!sekolah && sekolah.npsn === siswa.npsn;
  } else if (role === "dinas") {
    authorized = checkDinasAccess(credential);
  } else if (role === "capil") {
    authorized = checkCapilAccess(credential) && arrayToSet(getNPSNSudahSubmit())[siswa.npsn];
  }

  if (!authorized) {
    return { authorized: false, message: "Akses ditolak untuk melihat dokumen ini." };
  }

  var dok = getDokumenByIdPengajuan(idPengajuan);
  if (!dok) {
    return { authorized: false, message: "Dokumen untuk pengajuan ini belum tersedia." };
  }

  var linkMap = {
    foto: dok.linkFoto, ttd: dok.linkTtd, formulir: dok.linkFormulir,
    akta: dok.linkAkta, kk: dok.linkKK, ktp: dok.linkKTP,
    gabungan: dok.linkGabungan // 1 file PDF (Formulir+Akta+KK+KTP)
  };
  var url = linkMap[docType];
  if (!url) {
    var pesan = (docType === "gabungan")
      ? "File PDF gabungan (Formulir+Akta+KK+KTP) belum tersedia untuk pengajuan ini — kemungkinan diunggah sebelum fitur ini aktif, atau proses penggabungan sempat gagal. Minta orang tua/sekolah mengunggah ulang berkas melalui form, atau hubungi admin aplikasi."
      : "Jenis dokumen tidak dikenali.";
    return { authorized: false, message: pesan };
  }

  var fileId = extractDriveFileId(url);
  if (!fileId) {
    return { authorized: false, message: "Link dokumen tidak valid." };
  }

  return { authorized: true, fileId: fileId };
}

/**
 * Menambahkan pengambilan Blob di atas resolveDokumenAccess_() -- dipakai
 * apiGetDokumenFile() (cara lama berbasis base64, masih dipakai Dashboard
 * Sekolah untuk dokumen satuan yang ukurannya jauh lebih kecil).
 *
 * @return {Object} { authorized, message, blob, fileName, fileId }
 */
function resolveDokumenBlob_(role, credential, idPengajuan, docType) {
  var akses = resolveDokumenAccess_(role, credential, idPengajuan, docType);
  if (!akses.authorized) return akses;

  var file = DriveApp.getFileById(akses.fileId);
  return { authorized: true, blob: file.getBlob(), fileName: file.getName(), fileId: akses.fileId };
}

/**
 * RUNNING 3.7: dipakai Dashboard Capil. HANYA mengembalikan link Drive
 * (TIDAK mengunduh isi file sama sekali -- jauh lebih cepat & ringan
 * dibanding apiGetDokumenFile). Client (CapilJS.html) yang lalu membuka
 * link ini lewat window.open()/redirect di halamannya SENDIRI, karena
 * JavaScript di dalam halaman HTML yang di-generate langsung dari doGet
 * (?page=viewdoc) TERNYATA dibatasi sandbox Apps Script sehingga TIDAK BISA
 * memindahkan tab browser ke domain lain (percobaan redirect sebelumnya
 * gagal karena ini, bukan karena otorisasi/ukuran file).
 */
function apiGetDokumenViewUrl(role, credential, idPengajuan, docType) {
  try {
    var akses = resolveDokumenAccess_(role, credential, idPengajuan, docType);
    if (!akses.authorized) {
      return { success: false, message: akses.message };
    }
    return { success: true, url: "https://drive.google.com/file/d/" + akses.fileId + "/view" };
  } catch (err) {
    writeLog("ERROR_LIHAT_DOKUMEN", "", "", idPengajuan, String(err));
    return { success: false, message: "Terjadi kesalahan sistem: " + err.message };
  }
}

/**
 * @param {String} role - 'sekolah' | 'dinas' | 'capil'
 * @param {String} credential - NPSN (untuk sekolah) atau kode akses (dinas/capil)
 * @param {String} idPengajuan
 * @param {String} docType - 'foto' | 'ttd' | 'formulir' | 'akta' | 'kk' | 'ktp' | 'gabungan'
 */
function apiGetDokumenFile(role, credential, idPengajuan, docType) {
  try {
    var hasil = resolveDokumenBlob_(role, credential, idPengajuan, docType);
    if (!hasil.authorized) {
      return { success: false, message: hasil.message };
    }

    return {
      success: true,
      base64: Utilities.base64Encode(hasil.blob.getBytes()),
      mimeType: hasil.blob.getContentType(),
      fileName: hasil.fileName
    };
  } catch (err) {
    writeLog("ERROR_LIHAT_DOKUMEN", "", "", idPengajuan, String(err));
    return { success: false, message: "Terjadi kesalahan sistem: " + err.message };
  }
}

// ==================================================
// HELPER UMUM DASHBOARD
// ==================================================

function uniqueSorted(arr) {
  var seen = {};
  var out = [];
  arr.forEach(function (v) {
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  });
  out.sort();
  return out;
}

function arrayToSet(arr) {
  var set = {};
  arr.forEach(function (v) { set[v] = true; });
  return set;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Mengambil seluruh data dasar sekolah dari sheet `db` (dipakai untuk opsi
 * filter Kecamatan/Desa & menghitung total sekolah terdaftar).
 */
function getAllSchoolsBasicInfo() {
  var sheet = getSheet(SHEET_DB);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  return data.map(function (row) {
    return {
      namaSekolah: row[0],
      npsn: String(row[1]).trim(),
      bentukPendidikan: row[2],
      statusSekolah: row[3],
      alamat: row[4],
      desa: row[5],
      kecamatan: row[6]
    };
  }).filter(function (s) { return s.npsn; });
}

function countAllSchoolsInDb() {
  return getAllSchoolsBasicInfo().length;
}

/**
 * Mengekstrak File ID dari URL Google Drive standar, mis.
 * https://drive.google.com/file/d/FILE_ID/view -> FILE_ID
 */
function extractDriveFileId(url) {
  if (!url) return null;
  var match = String(url).match(/[-\w]{25,}/);
  return match ? match[0] : null;
}