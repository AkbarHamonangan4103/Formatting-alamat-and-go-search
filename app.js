const $ = id => document.getElementById(id);
const v = id => ($(id) ? $(id).value.trim() : "");

// Pasang aksi klik dengan aman: jika tombol tidak ada di HTML,
// script tidak berhenti dan tombol lain tetap jalan.
function klik(id, fn) {
  const el = $(id);
  if (!el) {
    console.warn("Elemen dengan id '" + id + "' tidak ditemukan di index.html");
    return;
  }
  el.addEventListener("click", fn);
}

const status = teks => { if ($("status")) $("status").textContent = teks; };

// Pemisah antar bagian depan (perumahan, desa, jalan, RT/RW).
// Ganti jadi ", " jika ingin dipisah koma.
const SEP = " ";

// ======================================================
// KONFIGURASI FIREBASE (isi dengan data dari proyek Anda)
// Firebase Console > Project settings > Your apps > Web app
// ======================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAykuFu2RNOHMWbgwpsbMochIpt8Os_WWI",
  authDomain: "formatting-alamat-iot.firebaseapp.com",
  databaseURL: "https://formatting-alamat-iot-default-rtdb.asia-southeast1.firebasedatabase.app",   // contoh: https://nama-proyek-default-rtdb.asia-southeast1.firebasedatabase.app
  projectId: "formatting-alamat-iot"
};

// ---------- Validasi & ambil data ----------
function validKoordinat(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
         lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

async function ambilAlamat(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
              `&addressdetails=1&zoom=18&accept-language=id&lat=${lat}&lon=${lon}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Gagal menghubungi layanan alamat");
  const data = await res.json();
  if (data.error) throw new Error("Alamat tidak ditemukan");
  return data;
}

// Cari jalan bernama terdekat (radius 60 meter) lewat Overpass API
async function cariJalanTerdekat(lat, lon) {
  const q = `[out:json][timeout:10];way(around:60,${lat},${lon})[highway][name];out tags center 10;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: "data=" + encodeURIComponent(q)
  });
  if (!res.ok) return "";
  const data = await res.json();
  if (!data.elements.length) return "";

  const jarak = e => {
    const dLat = e.center.lat - lat, dLon = e.center.lon - lon;
    return dLat * dLat + dLon * dLon;
  };
  data.elements.sort((a, b) => jarak(a) - jarak(b));
  return data.elements[0].tags.name;
}

// Cari satuan alamat berdasarkan kode pos
async function cariKodePos(kode) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2` +
              `&addressdetails=1&accept-language=id&countrycodes=id&limit=1` +
              `&postalcode=${encodeURIComponent(kode)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Gagal menghubungi layanan kode pos");
  const data = await res.json();
  if (!data.length) throw new Error("Kode pos tidak ditemukan");

  const a = data[0].address;
  const kab = a.regency ? "Kab. " + a.regency.replace(/^kabupaten\s+/i, "")
            : a.city    ? "Kota " + a.city.replace(/^kota\s+/i, "")
            : a.county || "";

  return [
    "Kode pos " + kode,
    a.village || a.suburb || a.neighbourhood,
    a.city_district || a.county_district || a.subdistrict,
    kab,
    a.state && a.state.replace(/^Daerah Istimewa/i, "DI"),
    "Indonesia"
  ].filter(Boolean).join(", ");
}

// ---------- Isi kolom otomatis ----------
function isiForm(data) {
  const a = data.address;
  const bukanJalan = !["highway", "place", "boundary"].includes(data.category);
  $("perumahan").value = a.residential || (bukanJalan && data.name) || "";
  $("desa").value      = a.hamlet || a.neighbourhood || "";
  $("jalan").value     = a.road || "";
  $("no").value        = a.house_number || "";
  $("kel").value       = a.village || a.suburb || "";
  $("kec").value       = a.city_district || a.county_district || a.subdistrict || "";
  $("kab").value       = a.regency || (a.city ? "" : a.county) || "";
  $("kota").value      = a.city || "";
  $("prov").value      = a.state || "";
  $("pos").value       = a.postcode || "";
}

// ---------- Pembersih simbol: hanya ( . , / - ----------
function bersihkan(teks) {
  return teks
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9\s().,\/-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,{2,}/g, ",")
    .replace(/\s+\./g, ".")
    .trim();
}

function lolosAturan(teks) {
  return /^[A-Za-z0-9\s().,\/-]*$/.test(teks);
}

// ---------- Susun alamat sesuai format ----------
function buang(teks, re) { return teks.replace(re, "").trim(); }

function susun() {
  // Jalan, No., Gg.
  const jalan = [
    v("jalan") && "Jl. " + buang(v("jalan"), /^(jalan|jl\.?)\s+/i),
    v("no")    && "No. " + v("no"),
    v("gang")  && "Gg. " + buang(v("gang"), /^(gang|gg\.?)\s+/i)
  ].filter(Boolean).join(" ");

  // RT/RW (hanya muncul jika ada)
  const rt = v("rt") && "RT. " + v("rt");
  const rw = v("rw") && "RW. " + v("rw");
  const rtrw = (rt && rw) ? rt + "/" + rw : (rt || rw || "");

  // Bagian depan
  const depan = [v("perumahan"), v("desa"), jalan, rtrw]
    .filter(Boolean).join(SEP);

  // Bagian wilayah
  const wilayah = [
    v("kel")  && "Kel. " + buang(v("kel"), /^(kelurahan|desa|kel\.?)\s+/i),
    v("kec")  && "Kec. " + buang(v("kec"), /^(kecamatan|kec\.?)\s+/i),
    v("kab")  && "Kab. " + buang(v("kab"), /^(kabupaten|kab\.?)\s+/i),
    v("kota") && "Kota " + buang(v("kota"), /^kota\s+/i),
    [v("prov"), v("pos")].filter(Boolean).join(" ")   // provinsi + kode pos 1 bagian
  ].filter(Boolean).join(", ");

  let teks = [depan, wilayah].filter(Boolean).join(", ");

  // Patokan: setelah titik, dipisah koma
  const patokan = v("patokan").split(",").map(s => s.trim()).filter(Boolean).join(", ");
  teks += patokan ? ". " + patokan : ".";

  return bersihkan(teks);
}

// ---------- Proses ----------
async function proses(lat, lon) {
  if (!validKoordinat(lat, lon)) {
    status("Koordinat tidak valid");
    return;
  }
  status("Mencari...");
  try {
    isiForm(await ambilAlamat(lat, lon));
    if (!$("jalan").value) {
      status("Mencari jalan terdekat...");
      try {
        $("jalan").value = await cariJalanTerdekat(lat, lon);
      } catch (e) { /* abaikan, isi manual */ }
    }
    status($("jalan").value
      ? "Selesai. Periksa & lengkapi kolom, lalu klik Buat Alamat."
      : "Jalan tidak ditemukan di peta. Isi manual (jalan, gang, RT/RW).");
  } catch (e) {
    status(e.message);
  }
}

// Baca koordinat dari kolom (format: lat, lon). Titik koma / spasi juga diterima.
function bacaKoordinat() {
  const bagian = v("koordinat").split(/[,;\s]+/).filter(Boolean).map(parseFloat);
  return [bagian[0], bagian[1]];
}

// ======================================================
// PANEL IoT: terima koordinat dari perangkat lewat Firebase
// ======================================================
function statusIot(teks, kelas) {
  const el = $("iotStatus");
  if (!el) return;
  el.textContent = teks;
  el.className = "iot-status" + (kelas ? " " + kelas : "");
}

function pakaiLaporan(lat, lon) {
  $("koordinat").value = lat + ", " + lon;
  proses(lat, lon);
}

function tambahLaporan(key, data, baru) {
  // Data dari perangkat tidak dipercaya: validasi dulu, tulis dengan textContent (bukan innerHTML)
  const lat = Number(data && data.lat);
  const lon = Number(data && data.lon);
  if (!validKoordinat(lat, lon)) return;

  const li = document.createElement("li");
  li.dataset.key = key;
  if (baru) li.className = "baru";

  const nama = document.createElement("div");
  nama.className = "perangkat";
  nama.textContent = String((data && data.device) || "Perangkat tanpa nama").slice(0, 40);

  const waktu = document.createElement("div");
  waktu.className = "waktu";
  waktu.textContent = data && data.waktu
    ? new Date(data.waktu).toLocaleString("id-ID")
    : "Waktu tidak diketahui";

  const koor = document.createElement("div");
  koor.className = "koor";
  koor.textContent = lat + ", " + lon;

  const tombol = document.createElement("button");
  tombol.type = "button";
  tombol.textContent = "Pakai koordinat ini";
  tombol.addEventListener("click", () => pakaiLaporan(lat, lon));

  li.append(nama, waktu, koor, tombol);

  const daftar = $("daftarIot");
  daftar.prepend(li);                       // terbaru di atas
  while (daftar.children.length > 20) daftar.lastChild.remove();
  if ($("iotKosong")) $("iotKosong").style.display = "none";

  if (baru && $("otomatis") && $("otomatis").checked) pakaiLaporan(lat, lon);
}

// Hapus laporan dari panel saat datanya dihapus di server (reset harian)
function hapusLaporan(key) {
  const daftar = $("daftarIot");
  [...daftar.children].forEach(li => { if (li.dataset.key === key) li.remove(); });
  if (!daftar.children.length && $("iotKosong")) $("iotKosong").style.display = "";
}

// Laporan hanya ditampilkan jika umurnya kurang dari 24 jam
const BATAS_JAM = 24;

function mulaiIot() {
  if (typeof firebase === "undefined") {
    statusIot("Firebase gagal dimuat (cek internet)", "off");
    return;
  }
  if (FIREBASE_CONFIG.apiKey.startsWith("ISI")) {
    statusIot("Belum dikonfigurasi (isi FIREBASE_CONFIG di app.js)", "off");
    return;
  }

  firebase.initializeApp(FIREBASE_CONFIG);
  const db = firebase.database();

  db.ref(".info/connected").on("value", s =>
    s.val() ? statusIot("Terhubung ke server", "on")
            : statusIot("Terputus dari server", "off"));

  const batasAwal = Date.now() - BATAS_JAM * 60 * 60 * 1000;
  const ref = db.ref("kecelakaan").orderByChild("waktu").startAt(batasAwal).limitToLast(20);
  let awalSelesai = false;

  // Data lama dimuat dulu; laporan yang datang sesudahnya ditandai "baru"
  ref.on("child_added", snap => tambahLaporan(snap.key, snap.val(), awalSelesai));
  ref.on("child_removed", snap => hapusLaporan(snap.key));
  ref.once("value", () => { awalSelesai = true; });
}

// ---------- Tombol ----------
klik("cari", () => proses(...bacaKoordinat()));

klik("lokasi", () => {
  if (!navigator.geolocation) {
    status("Browser tidak mendukung lokasi");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    p => {
      $("koordinat").value = p.coords.latitude + ", " + p.coords.longitude;
      proses(p.coords.latitude, p.coords.longitude);
    },
    () => status("Izin lokasi ditolak")
  );
});

klik("buat", () => {
  const hasil = susun();
  if (!lolosAturan(hasil)) {
    status("Hasil mengandung simbol terlarang");
    return;
  }
  $("hasil").value = hasil;
  status("Alamat dibuat");
});

klik("salin", async () => {
  try {
    await navigator.clipboard.writeText($("hasil").value);
    status("Alamat disalin");
  } catch (e) {
    status("Gagal menyalin. Blok teks hasil lalu tekan Ctrl + C.");
  }
});

klik("cariPos", async () => {
  const kode = v("pos");
  if (!/^\d{5}$/.test(kode)) {
    status("Isi Kode Pos 5 digit dulu");
    return;
  }
  status("Mencari kode pos...");
  try {
    $("additional").value = bersihkan(await cariKodePos(kode));
    status("Additional terisi");
  } catch (e) {
    status(e.message);
  }
});

// Tombol Go: buka Google Maps di tab baru
klik("go", () => {
  const [lat, lon] = bacaKoordinat();
  let query;

  if (validKoordinat(lat, lon)) {
    query = lat + "," + lon;          // pakai koordinat (paling akurat)
  } else if (v("hasil")) {
    query = v("hasil");               // cadangan: pakai teks alamat
  } else {
    status("Isi koordinat atau buat alamat dulu");
    return;
  }

  const url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
  const tab = window.open(url, "_blank");
  if (!tab) {
    // Pop-up diblokir browser: buka di tab yang sama
    window.location.href = url;
  }
  status("Membuka Google Maps...");
});

// Mode translucent (kaca buram), pilihan diingat di browser
(function () {
  const tombol = $("modeGlass");
  if (!tombol) return;

  function terapkan(aktif) {
    document.body.classList.toggle("glass", aktif);
    tombol.textContent = "Mode Translucent: " + (aktif ? "Hidup" : "Mati");
    tombol.setAttribute("aria-pressed", String(aktif));
  }

  let aktif = false;
  try { aktif = localStorage.getItem("modeGlass") === "1"; } catch (e) {}
  terapkan(aktif);

  tombol.addEventListener("click", () => {
    aktif = !aktif;
    terapkan(aktif);
    try { localStorage.setItem("modeGlass", aktif ? "1" : "0"); } catch (e) {}
  });
})();

// Jalankan koneksi IoT saat halaman dibuka
mulaiIot();