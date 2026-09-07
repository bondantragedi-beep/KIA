/**
 * Database.gs
 * Konfigurasi nama sheet, inisialisasi header, dan fungsi akses data.
 * APLIKASI PENDATAAN & PENGAJUAN KIA - KOTA MAKASSAR
 */

// ==================================================
// KONSTANTA NAMA SHEET
// ==================================================
var SHEET_DB = "db";                     // Sheet sekolah - sudah ada, JANGAN diubah strukturnya
var SHEET_SISWA = "siswa";
var SHEET_DOKUMEN = "dokumen";
var SHEET_STATUS_SEKOLAH = "status_sekolah";
var SHEET_LOG = "log";

// Header masing-masing sheet yang dikelola aplikasi (selain `db`)
var HEADERS = {};
HEADERS[SHEET_SISWA] = [
  "ID Pengajuan", "Timestamp", "Last Update",
  "NPSN", "Nama Sekolah", "Kecamatan", "Desa",
  "Jenjang", "Kelas Rombel",
  "Nama Anak", "Nomor Akta Kelahiran", "NIK", "Tempat Lahir", "Tanggal Lahir",
  "Jenis Kelamin", "Alamat Tempat Tinggal", "Nama Kepala Keluarga", "Nomor Kartu Keluarga",
  "Nama Ayah", "Nama Ibu", "Nama Pelapor", "Nomor Telepon Pelapor",
  "Status Siswa"
];
// RUNNING 2: struktur sheet `dokumen` diperbarui agar 1 baris = 1 pengajuan
// (bukan 1 baris per file), berisi seluruh link dokumen sekaligus.
// RUNNING 3.2: ditambah "Link Berkas Gabungan" di akhir (aditif) — 1 file PDF
// berisi Formulir+Akta+KK+KTP, dipakai sebagai TAMPILAN UTAMA di Dashboard Capil.
HEADERS[SHEET_DOKUMEN] = [
  "ID Pengajuan", "NIK", "NPSN", "Nama Siswa",
  "Link Foto", "Link Tanda Tangan", "Link Formulir KIA",
  "Link Akta", "Link KK", "Link KTP",
  "Status Dokumen", "Timestamp",
  "Link Berkas Gabungan"
];
// RUNNING 3: ditambah "Timestamp Submit" & "Disubmit Oleh" di akhir (aditif).
// Migrasi kolom baru pada sheet lama ditangani oleh ensureStatusSekolahExtended()
// agar baris data yang sudah ada TIDAK terhapus/berubah.
HEADERS[SHEET_STATUS_SEKOLAH] = [
  "NPSN", "Nama Sekolah", "Status", "Jumlah Siswa Terdaftar", "Jumlah Siswa Lengkap", "Last Update",
  "Timestamp Submit", "Disubmit Oleh"
];
HEADERS[SHEET_LOG] = [
  "Timestamp", "Aksi", "NPSN", "NIK", "ID Pengajuan", "Detail"
];

// ==================================================
// INISIALISASI DATABASE
// ==================================================

/**
 * Memastikan seluruh sheet aplikasi (selain `db`) sudah ada dan memiliki
 * header yang benar. Dipanggil otomatis saat aplikasi pertama kali dibuka.
 * Sheet `db` TIDAK disentuh oleh fungsi ini.
 */
function ensureDatabaseReady() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(HEADERS).forEach(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    var expectedHeader = HEADERS[sheetName];

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, expectedHeader.length).setValues([expectedHeader]);
      sheet.setFrozenRows(1);
      return;
    }

    // RUNNING 2: migrasi header otomatis HANYA jika sheet belum punya baris
    // data (misalnya sheet `dokumen` peninggalan RUNNING 1 yang strukturnya
    // sudah berubah). Jika sudah ada data, header TIDAK disentuh demi keamanan.
    if (sheet.getLastRow() === 1) {
      var currentHeader = sheet.getRange(1, 1, 1, expectedHeader.length).getValues()[0];
      var isSame = JSON.stringify(currentHeader) === JSON.stringify(expectedHeader);
      if (!isSame) {
        sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), expectedHeader.length)).clearContent();
        sheet.getRange(1, 1, 1, expectedHeader.length).setValues([expectedHeader]);
        sheet.setFrozenRows(1);
      }
    }
  });

  // RUNNING 3: migrasi ADITIF kolom baru pada sheet `status_sekolah` yang
  // sudah berisi data dari RUNNING 1/2 (6 kolom) menjadi 8 kolom. Baris data
  // yang sudah ada TIDAK diubah/dihapus; hanya header kolom baru ditambahkan.
  ensureStatusSekolahExtended();

  // RUNNING 3.2: migrasi ADITIF kolom "Link Berkas Gabungan" pada sheet
  // `dokumen` yang sudah berisi data dari RUNNING 2 (12 kolom) menjadi 13
  // kolom. Baris data yang sudah ada TIDAK diubah/dihapus.
  ensureDokumenExtended();

  return true;
}

function ensureDokumenExtended() {
  var sheet = getSheet(SHEET_DOKUMEN);
  var expectedHeader = HEADERS[SHEET_DOKUMEN];
  var currentLastCol = sheet.getLastColumn();

  if (currentLastCol < expectedHeader.length) {
    var missingHeaders = expectedHeader.slice(currentLastCol);
    sheet.getRange(1, currentLastCol + 1, 1, missingHeaders.length).setValues([missingHeaders]);
  }
}

function ensureStatusSekolahExtended() {
  var sheet = getSheet(SHEET_STATUS_SEKOLAH);
  var expectedHeader = HEADERS[SHEET_STATUS_SEKOLAH];
  var currentLastCol = sheet.getLastColumn();

  if (currentLastCol < expectedHeader.length) {
    var missingHeaders = expectedHeader.slice(currentLastCol);
    sheet.getRange(1, currentLastCol + 1, 1, missingHeaders.length).setValues([missingHeaders]);
  }
}

function getSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Sheet '" + sheetName + "' tidak ditemukan.");
  }
  return sheet;
}

// ==================================================
// SEKOLAH (sheet `db`)
// ==================================================

/**
 * Mencari data sekolah berdasarkan NPSN pada sheet `db`.
 * Mengembalikan object data sekolah atau null jika tidak ditemukan.
 */
function findSchoolByNPSN(npsn) {
  var sheet = getSheet(SHEET_DB);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var npsnStr = String(npsn).trim();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    // Kolom: Nama Satuan Pendidikan(0) | NPSN(1) | Bentuk Pendidikan(2) | Status Sekolah(3) | Alamat(4) | Desa(5) | Kecamatan(6)
    if (String(row[1]).trim() === npsnStr) {
      return {
        namaSekolah: row[0],
        npsn: String(row[1]).trim(),
        bentukPendidikan: row[2],
        statusSekolah: row[3],
        alamat: row[4],
        desa: row[5],
        kecamatan: row[6]
      };
    }
  }
  return null;
}

// ==================================================
// SISWA (sheet `siswa`)
// ==================================================

/**
 * Mengecek apakah NIK sudah pernah terdaftar (mencegah duplikasi data siswa).
 */
function isNIKAlreadyRegistered(nik) {
  var sheet = getSheet(SHEET_SISWA);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var nikColumn = sheet.getRange(2, 12, lastRow - 1, 1).getValues(); // kolom NIK = index 12
  var nikStr = String(nik).trim();

  for (var i = 0; i < nikColumn.length; i++) {
    if (String(nikColumn[i][0]).trim() === nikStr) {
      return true;
    }
  }
  return false;
}

/**
 * Menyimpan satu baris data siswa ke sheet `siswa`.
 * Mengembalikan ID Pengajuan yang dihasilkan.
 */
function insertSiswa(data, statusSiswa) {
  var sheet = getSheet(SHEET_SISWA);
  var idPengajuan = generateIdPengajuan();
  var now = new Date();

  var row = [
    idPengajuan,
    now,
    now,
    data.npsn,
    data.namaSekolah,
    data.kecamatan,
    data.desa,
    data.jenjang,
    data.kelasRombel,
    data.namaAnak,
    data.nomorAkta || "",
    data.nik,
    data.tempatLahir,
    data.tanggalLahir,
    data.jenisKelamin,
    data.alamatTinggal,
    data.namaKepalaKeluarga,
    data.nomorKK,
    data.namaAyah,
    data.namaIbu,
    data.namaPelapor,
    data.nomorHpPelapor,
    statusSiswa
  ];

  sheet.appendRow(row);
  return idPengajuan;
}

/**
 * Mencari nomor baris (1-based, termasuk header) pada sheet `siswa`
 * berdasarkan ID Pengajuan. Mengembalikan -1 jika tidak ditemukan.
 */
function findSiswaRowIndexById(idPengajuan) {
  var sheet = getSheet(SHEET_SISWA);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var target = String(idPengajuan).trim();

  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === target) return i + 2;
  }
  return -1;
}

/**
 * Mengambil satu baris data siswa lengkap berdasarkan ID Pengajuan.
 * Kolom di-mapping manual sesuai urutan HEADERS[SHEET_SISWA] pada RUNNING 1
 * (JANGAN ubah urutan HEADERS[SHEET_SISWA] tanpa menyesuaikan index di sini).
 */
function getSiswaById(idPengajuan) {
  var rowIndex = findSiswaRowIndexById(idPengajuan);
  if (rowIndex === -1) return null;

  var sheet = getSheet(SHEET_SISWA);
  var row = sheet.getRange(rowIndex, 1, 1, HEADERS[SHEET_SISWA].length).getValues()[0];
  return mapSiswaRow(row, rowIndex);
}

/**
 * Mengubah satu baris array data siswa (urutan sesuai HEADERS[SHEET_SISWA])
 * menjadi object siswa yang mudah dipakai di seluruh dashboard.
 */
function mapSiswaRow(row, rowIndex) {
  return {
    _rowIndex: rowIndex,
    idPengajuan: row[0],
    timestamp: row[1],
    lastUpdate: row[2],
    npsn: String(row[3]).trim(),
    namaSekolah: row[4],
    kecamatan: row[5],
    desa: row[6],
    jenjang: row[7],
    kelasRombel: row[8],
    namaAnak: row[9],
    nomorAkta: row[10],
    nik: row[11],
    tempatLahir: row[12],
    tanggalLahir: row[13],
    jenisKelamin: row[14],
    alamatTinggal: row[15],
    namaKepalaKeluarga: row[16],
    nomorKK: row[17],
    namaAyah: row[18],
    namaIbu: row[19],
    namaPelapor: row[20],
    nomorHpPelapor: row[21],
    statusSiswa: row[22]
  };
}

/**
 * Mengambil SELURUH data siswa pada sheet `siswa` sebagai array object.
 * Dipakai oleh Dashboard Sekolah (difilter NPSN), Dashboard Dinas (semua),
 * dan Dashboard Capil (difilter status_sekolah = SUDAH SUBMIT).
 */
function getAllSiswaRows() {
  var sheet = getSheet(SHEET_SISWA);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, HEADERS[SHEET_SISWA].length).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    result.push(mapSiswaRow(data[i], i + 2));
  }
  return result;
}

/**
 * Mengambil daftar siswa untuk satu NPSN saja (dipakai Dashboard Sekolah).
 */
function getSiswaListByNPSN(npsn) {
  var npsnStr = String(npsn).trim();
  return getAllSiswaRows().filter(function (s) { return s.npsn === npsnStr; });
}

/**
 * Update kolom "Status Siswa" dan "Last Update" pada baris siswa tertentu.
 */
function updateStatusSiswaByRowIndex(rowIndex, status) {
  var sheet = getSheet(SHEET_SISWA);
  sheet.getRange(rowIndex, 23).setValue(status); // kolom ke-23 = Status Siswa
  sheet.getRange(rowIndex, 3).setValue(new Date()); // kolom ke-3 = Last Update
}

// ==================================================
// DOKUMEN (sheet `dokumen`)
// ==================================================

/**
 * Menyimpan / memperbarui satu baris ringkasan dokumen untuk satu ID
 * Pengajuan. Jika ID Pengajuan sudah ada barisnya, baris tersebut ditimpa
 * (upsert) supaya submit ulang tidak menghasilkan baris ganda.
 */
function upsertDokumen(data) {
  var sheet = getSheet(SHEET_DOKUMEN);
  var lastRow = sheet.getLastRow();
  var rowIndex = -1;
  var target = String(data.idPengajuan).trim();

  if (lastRow >= 2) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === target) {
        rowIndex = i + 2;
        break;
      }
    }
  }

  var rowValues = [
    data.idPengajuan, data.nik, data.npsn, data.namaSiswa,
    data.linkFoto, data.linkTtd, data.linkFormulir,
    data.linkAkta, data.linkKK, data.linkKTP,
    data.statusDokumen, new Date(),
    data.linkGabungan || ""
  ];

  if (rowIndex === -1) {
    sheet.appendRow(rowValues);
  } else {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  }
}

/**
 * Mengambil satu baris ringkasan dokumen berdasarkan ID Pengajuan.
 * Dipakai oleh fitur "Lihat Dokumen" di Dashboard Sekolah/Dinas/Capil.
 */
function getDokumenByIdPengajuan(idPengajuan) {
  var sheet = getSheet(SHEET_DOKUMEN);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var target = String(idPengajuan).trim();
  var data = sheet.getRange(2, 1, lastRow - 1, HEADERS[SHEET_DOKUMEN].length).getValues();

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === target) {
      var row = data[i];
      return {
        idPengajuan: row[0], nik: row[1], npsn: String(row[2]).trim(), namaSiswa: row[3],
        linkFoto: row[4], linkTtd: row[5], linkFormulir: row[6],
        linkAkta: row[7], linkKK: row[8], linkKTP: row[9],
        statusDokumen: row[10], timestamp: row[11],
        linkGabungan: row[12] || ""
      };
    }
  }
  return null;
}

// ==================================================
// STATUS SEKOLAH (sheet `status_sekolah`)
// ==================================================

/**
 * Update ringkasan status sekolah setiap kali ada data siswa baru masuk.
 * Tombol SUBMIT sekolah belum dibuat pada RUNNING 1, jadi status hanya
 * berpindah otomatis antara BELUM MENGISI <-> SEDANG MENGISI.
 */
function updateStatusSekolah(npsn, namaSekolah) {
  var sheet = getSheet(SHEET_STATUS_SEKOLAH);
  var lastRow = sheet.getLastRow();
  var npsnStr = String(npsn).trim();
  var rowIndex = -1;

  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === npsnStr) {
        rowIndex = i + 2; // +2 karena mulai baris 2 dan index 0-based
        break;
      }
    }
  }

  var counts = countSiswaByNPSN(npsnStr);
  var now = new Date();

  if (rowIndex === -1) {
    sheet.appendRow([
      npsnStr, namaSekolah, "SEDANG MENGISI",
      counts.total, counts.lengkap, now, "", ""
    ]);
  } else {
    var existingStatus = sheet.getRange(rowIndex, 3).getValue();
    // Jangan menurunkan status yang sudah SUDAH SUBMIT (data terkunci).
    // Pemanggilan fungsi ini seharusnya sudah dicegah oleh isSekolahLocked()
    // di lapisan API, tapi guard ini tetap dipasang untuk keamanan berlapis.
    if (existingStatus !== "SUDAH SUBMIT") {
      sheet.getRange(rowIndex, 3).setValue("SEDANG MENGISI");
    }
    sheet.getRange(rowIndex, 4).setValue(counts.total);
    sheet.getRange(rowIndex, 5).setValue(counts.lengkap);
    sheet.getRange(rowIndex, 6).setValue(now);
  }
}

/**
 * Mengambil satu baris ringkasan status_sekolah berdasarkan NPSN.
 * Mengembalikan null jika sekolah belum pernah punya baris (BELUM MENGISI).
 */
function getStatusSekolahByNPSN(npsn) {
  var sheet = getSheet(SHEET_STATUS_SEKOLAH);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var npsnStr = String(npsn).trim();
  var data = sheet.getRange(2, 1, lastRow - 1, HEADERS[SHEET_STATUS_SEKOLAH].length).getValues();

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === npsnStr) {
      return mapStatusSekolahRow(data[i], i + 2);
    }
  }
  return null;
}

/**
 * Mengambil SELURUH baris status_sekolah (dipakai Dashboard Dinas).
 */
function getAllStatusSekolahRows() {
  var sheet = getSheet(SHEET_STATUS_SEKOLAH);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, HEADERS[SHEET_STATUS_SEKOLAH].length).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    result.push(mapStatusSekolahRow(data[i], i + 2));
  }
  return result;
}

function mapStatusSekolahRow(row, rowIndex) {
  return {
    _rowIndex: rowIndex,
    npsn: String(row[0]).trim(),
    namaSekolah: row[1],
    status: row[2],
    jumlahSiswa: row[3] || 0,
    jumlahLengkap: row[4] || 0,
    lastUpdate: row[5],
    timestampSubmit: row[6] || "",
    disubmitOleh: row[7] || ""
  };
}

/**
 * Mengecek apakah data sekolah (NPSN tertentu) sudah TERKUNCI karena sudah
 * SUDAH SUBMIT. Dipakai untuk menolak input/upload baru dari orang tua
 * maupun perubahan dari sekolah setelah submit final ke Dinas.
 */
function isSekolahLocked(npsn) {
  var status = getStatusSekolahByNPSN(npsn);
  return !!status && status.status === "SUDAH SUBMIT";
}

/**
 * Menandai satu sekolah sebagai SUDAH SUBMIT: mencatat timestamp & siapa
 * yang mengonfirmasi. Baris status_sekolah WAJIB sudah ada (sekolah yang
 * belum pernah punya siswa tidak mungkin submit).
 */
function updateStatusSekolahSubmit(npsn, submittedBy) {
  var sheet = getSheet(SHEET_STATUS_SEKOLAH);
  var status = getStatusSekolahByNPSN(npsn);
  if (!status) {
    throw new Error("Sekolah belum memiliki data siswa, tidak dapat disubmit.");
  }

  var now = new Date();
  sheet.getRange(status._rowIndex, 3).setValue("SUDAH SUBMIT"); // kolom Status
  sheet.getRange(status._rowIndex, 6).setValue(now);            // Last Update
  sheet.getRange(status._rowIndex, 7).setValue(now);            // Timestamp Submit
  sheet.getRange(status._rowIndex, 8).setValue(submittedBy || "Tidak diketahui"); // Disubmit Oleh
}

/**
 * Menghitung jumlah siswa terdaftar & lengkap untuk satu NPSN.
 */
function countSiswaByNPSN(npsn) {
  var sheet = getSheet(SHEET_SISWA);
  var lastRow = sheet.getLastRow();
  var total = 0;
  var lengkap = 0;

  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 23).getValues();
    var npsnStr = String(npsn).trim();
    data.forEach(function (row) {
      if (String(row[3]).trim() === npsnStr) { // kolom NPSN = index 3
        total++;
        if (row[22] === "LENGKAP") lengkap++; // kolom Status Siswa = index 22
      }
    });
  }

  return { total: total, lengkap: lengkap };
}

// ==================================================
// LOG (sheet `log`)
// ==================================================

function writeLog(aksi, npsn, nik, idPengajuan, detail) {
  var sheet = getSheet(SHEET_LOG);
  sheet.appendRow([new Date(), aksi, npsn || "", nik || "", idPengajuan || "", detail || ""]);
}