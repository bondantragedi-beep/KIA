/**
 * PDFFormulir.gs
 * Pembuatan PDF Formulir Kartu Identitas Anak (KIA) secara otomatis
 * menggunakan Google Docs sebagai mesin render (DocumentApp bawaan
 * Apps Script, tidak perlu Advanced Service tambahan).
 *
 * APLIKASI PENDATAAN & PENGAJUAN KIA - KOTA MAKASSAR
 *
 * RUNNING 3.2: Layout disesuaikan PERSIS mengikuti contoh formulir KIA asli
 * yang diberikan (kop Pemkot Makassar + Dinas Dukcapil dengan logo, judul
 * "FORMULIR KARTU IDENTITAS ANAK" bergaris bawah, 12 butir data bernomor
 * — termasuk butir 10 "NAMA ORANG TUA" dengan sub-butir a. NAMA AYAH dan
 * b. NAMA IBU — kotak Pas Foto 3x4 di kiri bawah, tanggal & tanda tangan
 * pelapor di kanan bawah, dan daftar "Berkas persyaratan yang dilampirkan".
 *
 * CATATAN JUJUR SOAL KETERBATASAN: Google Apps Script (DocumentApp) tidak
 * mendukung border per-sel tabel (hanya border se-tabel), sehingga kotak
 * "Pas Foto 3x4" pada versi cetak ini TIDAK memiliki garis kotak eksplisit
 * seperti pada form kosong aslinya — foto anak yang sudah diunggah langsung
 * ditampilkan (bentuk foto itu sendiri sudah menjadi penanda visualnya).
 * Info sekolah (NPSN/Kelas/Rombel) tidak ada pada contoh form asli, jadi
 * disisipkan sebagai satu baris kecil di footer saja (tidak mengganggu
 * tampilan utama) supaya tetap berguna untuk verifikasi administratif.
 */

/**
 * Membuat PDF Formulir KIA untuk satu siswa.
 * @param {Object} siswa - object hasil getSiswaById()
 * @param {Blob} fotoBlob - blob foto anak (3x4)
 * @param {Blob} ttdBlob - blob tanda tangan (PNG transparan)
 * @param {String} targetBaseName - nama dasar file, mis. "NIK_NamaSiswa_FormulirKIA"
 * @return {Blob} blob PDF formulir yang sudah jadi
 */
function generateFormulirKiaPdf(siswa, fotoBlob, ttdBlob, targetBaseName) {
  var doc = DocumentApp.create(targetBaseName + "_temp");
  var body = doc.getBody();
  body.setMarginTop(30);
  body.setMarginBottom(30);
  body.setMarginLeft(46);
  body.setMarginRight(46);

  // ================= KOP SURAT (logo kiri + teks instansi) =================
  var logoBlob = getLogoBlob(); // dari Utils.gs, File ID sesuai link yang diberikan

  var kopTable = body.appendTable();
  kopTable.setBorderWidth(0);
  var kopRow = kopTable.appendTableRow();

  var cellLogo = kopRow.appendTableCell("");
  cellLogo.setWidth(62);
  if (logoBlob) {
    try {
      var logoImg = cellLogo.appendImage(logoBlob);
      logoImg.setWidth(56);
      logoImg.setHeight(56);
    } catch (eLogo) {
      Logger.log("Gagal menempel logo di PDF: " + eLogo);
    }
  }

  var cellInstansi = kopRow.appendTableCell("");
  setFirstParagraphText_(cellInstansi, "PEMERINTAH KOTA MAKASSAR").setBold(true).setFontSize(13);
  cellInstansi.getChild(0).asParagraph().editAsText().setUnderline(false);
  var pInstansi2 = cellInstansi.appendParagraph("DINAS KEPENDUDUKAN DAN PENCATATAN SIPIL");
  pInstansi2.setBold(true).setFontSize(15);
  pInstansi2.editAsText().setUnderline(false);
  var pAlamat1 = cellInstansi.appendParagraph("Jalan. Slt.Alauddin No.295 Makassar 90222, email info@dukcapilmakassar.co.id");
  pAlamat1.setFontSize(8);
  pAlamat1.editAsText().setUnderline(false);
  var pAlamat2 = cellInstansi.appendParagraph("website www.dukcapilmakassar.co.id");
  pAlamat2.setFontSize(8);
  pAlamat2.editAsText().setUnderline(false);

  body.appendParagraph("").setSpacingAfter(2);
  body.appendHorizontalRule();
  body.appendHorizontalRule(); // digandakan agar terkesan garis tebal seperti contoh asli

  // ================= JUDUL FORMULIR =================
  var pJudul = body.appendParagraph("FORMULIR KARTU IDENTITAS ANAK");
  pJudul.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  pJudul.setBold(true);
  pJudul.setFontSize(12);
  pJudul.setSpacingBefore(12);
  pJudul.setSpacingAfter(16);
  pJudul.editAsText().setUnderline(true);

  // ================= 12 BUTIR DATA (bernomor, sesuai contoh formulir) =================
  var dataTable = body.appendTable();
  dataTable.setBorderWidth(0);

  function tambahBaris(labelBernomor, nilai, indent) {
    var row = dataTable.appendTableRow();
    var c1 = row.appendTableCell((indent ? "        " : "") + labelBernomor);
    c1.setWidth(232);
    c1.editAsText().setFontSize(10).setUnderline(false);
    var c2 = row.appendTableCell(":");
    c2.setWidth(10);
    c2.editAsText().setFontSize(10).setUnderline(false);
    var c3 = row.appendTableCell(safeVal(nilai));
    c3.editAsText().setFontSize(10).setUnderline(false);
    return row;
  }

  tambahBaris("1.  NAMA ANAK", siswa.namaAnak);
  tambahBaris("2.  NOMOR AKTA KELAHIRAN", siswa.nomorAkta);
  tambahBaris("3.  NO. INDUK KEPENDUDUKAN", siswa.nik);
  tambahBaris("4.  TEMPAT LAHIR", siswa.tempatLahir);
  tambahBaris("5.  TANGGAL LAHIR", formatTanggalIndo(siswa.tanggalLahir));
  tambahBaris("6.  JENIS KELAMIN", siswa.jenisKelamin);
  tambahBaris("7.  ALAMAT TEMPAT TINGGAL", siswa.alamatTinggal);
  tambahBaris("8.  NAMA KEPALA KELUARGA", siswa.namaKepalaKeluarga);
  tambahBaris("9.  NOMOR KARTU KELUARGA", siswa.nomorKK);

  // Butir 10 hanya judul kelompok (tanpa nilai), diikuti sub-butir a & b
  var rowOrtu = dataTable.appendTableRow();
  var cOrtuLabel = rowOrtu.appendTableCell("10.  NAMA ORANG TUA");
  cOrtuLabel.setWidth(232);
  cOrtuLabel.editAsText().setFontSize(10).setUnderline(false);
  rowOrtu.appendTableCell("").setWidth(10);
  rowOrtu.appendTableCell("");

  tambahBaris("a.  NAMA AYAH", siswa.namaAyah, true);
  tambahBaris("b.  NAMA IBU", siswa.namaIbu, true);

  tambahBaris("11.  NAMA PELAPOR", siswa.namaPelapor);
  tambahBaris("12.  NO TELPON/HP PELAPOR", siswa.nomorHpPelapor);

  body.appendParagraph("").setSpacingAfter(18);

  // ================= PAS FOTO (kiri) + TANGGAL & TANDA TANGAN (kanan) =================
  var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Makassar", "dd MMMM yyyy");

  var bottomTable = body.appendTable();
  bottomTable.setBorderWidth(0);
  var bottomRow = bottomTable.appendTableRow();

  var cellFoto = bottomRow.appendTableCell("");
  cellFoto.setWidth(175);
  if (fotoBlob) {
    var fotoImg = cellFoto.appendImage(fotoBlob);
    fotoImg.setWidth(90);
    fotoImg.setHeight(115); // rasio mendekati pas foto 3x4
    var pCaption = cellFoto.appendParagraph("Pas Foto 3x4");
    pCaption.setFontSize(8).setItalic(true);
    pCaption.editAsText().setUnderline(false);
  } else {
    var pNoFoto = cellFoto.appendParagraph("(Pas Foto 3x4 belum diunggah)");
    pNoFoto.setFontSize(9);
    pNoFoto.editAsText().setUnderline(false);
  }

  var cellTtd = bottomRow.appendTableCell("");
  var pTanggal = cellTtd.appendParagraph("Makassar, " + todayStr);
  pTanggal.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  pTanggal.setFontSize(10);
  pTanggal.editAsText().setUnderline(false);

  var pLabelTtd = cellTtd.appendParagraph("Ttd Pelapor,");
  pLabelTtd.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  pLabelTtd.setFontSize(10);
  pLabelTtd.editAsText().setUnderline(false);

  if (ttdBlob) {
    var ttdImg = cellTtd.appendImage(ttdBlob);
    ttdImg.setWidth(130);
    ttdImg.setHeight(65);
    var ttdParent = ttdImg.getParent();
    if (ttdParent && ttdParent.asParagraph) {
      ttdParent.asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
    }
  } else {
    cellTtd.appendParagraph("").setSpacingAfter(50);
  }

  var pNamaPelapor = cellTtd.appendParagraph("( " + safeVal(siswa.namaPelapor) + " )");
  pNamaPelapor.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  pNamaPelapor.setBold(true);
  pNamaPelapor.setFontSize(10);
  pNamaPelapor.editAsText().setUnderline(false);

  // ================= BERKAS PERSYARATAN YANG DILAMPIRKAN =================
  body.appendParagraph("").setSpacingAfter(20);
  var pBerkasJudul = body.appendParagraph("Berkas persyaratan yang dilampirkan :");
  pBerkasJudul.setBold(true);
  pBerkasJudul.setFontSize(9);
  pBerkasJudul.editAsText().setUnderline(false);

  var checklist = [
    "Fotocopy Akta Kelahiran",
    "Fotocopy Kartu Keluarga",
    "Fotocopy KTP orangtua",
    "Pas foto ukuran 3x4 berwarna (2 lembar) bagi anak usia 5-16 tahun"
  ];
  checklist.forEach(function (item, idx) {
    var pItem = body.appendParagraph("     " + (idx + 1) + ". " + item);
    pItem.setFontSize(9);
    pItem.editAsText().setUnderline(false);
  });

  // ================= CATATAN ADMINISTRATIF KECIL (tidak ada di form asli) =================
  // Baris kecil ini disisipkan HANYA agar sekolah/dinas/capil bisa memverifikasi
  // asal sekolah & kelas pengaju tanpa membuka sheet; tidak mengubah tampilan
  // utama formulir yang sudah mengikuti contoh asli.
  var pMeta = body.appendParagraph(
    "Sekolah: " + safeVal(siswa.namaSekolah) + "  |  NPSN: " + safeVal(siswa.npsn) +
    "  |  Jenjang/Kelas: " + safeVal(siswa.jenjang) + " - " + safeVal(siswa.kelasRombel) +
    "  |  ID Pengajuan: " + safeVal(siswa.idPengajuan)
  );
  pMeta.setFontSize(7);
  pMeta.setItalic(true);
  pMeta.setSpacingBefore(16);
  pMeta.editAsText().setUnderline(false);

  // ================= EXPORT KE PDF & BERSIHKAN FILE SEMENTARA =================
  doc.saveAndClose();
  var docFile = DriveApp.getFileById(doc.getId());
  var pdfBlob = docFile.getAs("application/pdf").setName(targetBaseName + ".pdf");
  // RUNNING 4: docFile.setTrashed(true) dipindah ke pembersihan terjadwal
  // (bersihkanDokumenSementara di Drive.gs) supaya proses upload tidak perlu
  // menunggu 1 panggilan Drive API tambahan ini. Lihat catatan lengkap di
  // Drive.gs pada fungsi convertImageBlobToPdf.
  return pdfBlob;
}

/**
 * Mengisi paragraf PERTAMA (bawaan kosong) pada sebuah TableCell dengan teks,
 * lalu mengembalikan objek Text-nya agar bisa langsung di-chain (.setBold(), dst).
 * Menghindari baris kosong tak sengaja di awal sel (setiap TableCell baru
 * selalu punya 1 paragraf kosong bawaan dari DocumentApp).
 */
function setFirstParagraphText_(cell, text) {
  var first = cell.getChild(0).asParagraph();
  first.setText(text);
  return first;
}

function safeVal(v) {
  return (v === null || v === undefined || v === "") ? "-" : String(v);
}

/**
 * Memformat tanggal (Date object ATAU string "yyyy-MM-dd" dari <input type=date>)
 * menjadi format Indonesia, mis. "14 Mei 2019".
 */
function formatTanggalIndo(tanggalValue) {
  if (!tanggalValue) return "-";

  var d;
  if (Object.prototype.toString.call(tanggalValue) === "[object Date]") {
    d = tanggalValue;
  } else {
    d = new Date(tanggalValue);
  }

  if (isNaN(d.getTime())) return String(tanggalValue);
  return Utilities.formatDate(d, Session.getScriptTimeZone() || "Asia/Makassar", "dd MMMM yyyy");
}