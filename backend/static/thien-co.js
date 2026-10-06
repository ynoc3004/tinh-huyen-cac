// Thiên cơ: lịch âm (thuật toán Hồ Ngọc Đức, múi giờ Việt Nam), can chi, tiết khí, canh giờ,
// giờ mặt trời mọc/lặn, pha trăng và quy đổi mã thời tiết. Không cần mạng.
(function (root) {
  "use strict";
  const INT = Math.floor, PI = Math.PI, TZ = 7; // lịch âm Việt Nam dùng múi giờ +7
  const CAN = ["Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ", "Canh", "Tân", "Nhâm", "Quý"];
  const CHI = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"];
  const TIET_KHI = ["Xuân phân", "Thanh minh", "Cốc vũ", "Lập hạ", "Tiểu mãn", "Mang chủng", "Hạ chí", "Tiểu thử",
    "Đại thử", "Lập thu", "Xử thử", "Bạch lộ", "Thu phân", "Hàn lộ", "Sương giáng", "Lập đông", "Tiểu tuyết",
    "Đại tuyết", "Đông chí", "Tiểu hàn", "Đại hàn", "Lập xuân", "Vũ thủy", "Kinh trập"];
  const THU = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

  function jdFromDate(dd, mm, yy) {
    const a = INT((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
    let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
    if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
    return jd;
  }
  function newMoon(k) {
    const T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
    let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
    Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
    const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
    const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
    C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
    C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
    C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
    C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
    C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
    C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
    const dt = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
      : -0.000278 + 0.000265 * T + 0.000262 * T2;
    return Jd1 + C1 - dt;
  }
  function sunLongitude(jdn) {
    const T = (jdn - 2451545.5) / 36525, T2 = T * T, dr = PI / 180;
    const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
    const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
    DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
    let L = (L0 + DL) * dr;
    return L - PI * 2 * INT(L / (PI * 2));
  }
  const sunLong30 = jdn => INT(sunLongitude(jdn - 0.5 - TZ / 24) / PI * 6);
  const newMoonDay = k => INT(newMoon(k) + 0.5 + TZ / 24);
  function lunarMonth11(yy) {
    const k = INT((jdFromDate(31, 12, yy) - 2415021) / 29.530588853);
    let nm = newMoonDay(k);
    if (sunLong30(nm) >= 9) nm = newMoonDay(k - 1);
    return nm;
  }
  function leapOffset(a11) {
    const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
    let last = 0, i = 1, arc = sunLong30(newMoonDay(k + i));
    do { last = arc; i++; arc = sunLong30(newMoonDay(k + i)); } while (arc !== last && i < 14);
    return i - 1;
  }
  function solar2lunar(dd, mm, yy) {
    const dayNumber = jdFromDate(dd, mm, yy);
    const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
    let monthStart = newMoonDay(k + 1);
    if (monthStart > dayNumber) monthStart = newMoonDay(k);
    let a11 = lunarMonth11(yy), b11 = a11, lunarYear;
    if (a11 >= monthStart) { lunarYear = yy; a11 = lunarMonth11(yy - 1); }
    else { lunarYear = yy + 1; b11 = lunarMonth11(yy + 1); }
    const day = dayNumber - monthStart + 1, diff = INT((monthStart - a11) / 29);
    let leap = 0, month = diff + 11;
    if (b11 - a11 > 365) {
      const lm = leapOffset(a11);
      if (diff >= lm) { month = diff + 10; if (diff === lm) leap = 1; }
    }
    if (month > 12) month -= 12;
    if (month >= 11 && diff < 4) lunarYear -= 1;
    return { day, month, year: lunarYear, leap, jd: dayNumber };
  }
  const canChiYear = y => CAN[(y + 6) % 10] + " " + CHI[(y + 8) % 12];
  const canChiDay = jd => CAN[(jd + 9) % 10] + " " + CHI[(jd + 1) % 12];
  const canChiMonth = (y, m) => CAN[(y * 12 + m + 3) % 10] + " " + CHI[(m + 1) % 12];
  const tietKhi = jd => TIET_KHI[INT(sunLongitude(jd - 0.5 - TZ / 24) / PI * 12) % 24];

  // Âm lịch đầy đủ cho một Date (giờ địa phương của máy)
  function lunar(date) {
    const L = solar2lunar(date.getDate(), date.getMonth() + 1, date.getFullYear());
    return Object.assign(L, {
      yearName: canChiYear(L.year), dayName: canChiDay(L.jd), monthName: canChiMonth(L.year, L.month),
      tietKhi: tietKhi(L.jd), weekday: THU[date.getDay()],
    });
  }

  // Canh giờ: 12 giờ địa chi, mỗi giờ dài 2 tiếng, giờ Tý bắt đầu lúc 23h
  function canhGio(date) {
    const h = date.getHours() + date.getMinutes() / 60;
    const idx = INT(((h + 1) % 24) / 2);
    return { index: idx, name: CHI[idx], from: (2 * idx + 23) % 24, to: (2 * idx + 1) % 24 };
  }

  // Mặt trời mọc/lặn (công thức sunrise equation), trả về Date; null nếu cực đới
  function sunTimes(date, lat, lon) {
    const rad = PI / 180;
    const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    const jd = noon.getTime() / 86400000 + 2440587.5;
    const n = Math.ceil(jd - 2451545.0 + 0.0008);
    const Js = n - lon / 360; // kinh độ Đông là dương
    const M = (357.5291 + 0.98560028 * Js) % 360;
    const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    const lam = (M + C + 180 + 102.9372) % 360;
    const Jt = 2451545.0 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
    const sinD = Math.sin(lam * rad) * Math.sin(23.4397 * rad);
    const cosD = Math.cos(Math.asin(sinD));
    const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinD) / (Math.cos(lat * rad) * cosD);
    if (cosW > 1 || cosW < -1) return null;
    const w = Math.acos(cosW) / rad;
    const toDate = j => new Date((j - 2440587.5) * 86400000);
    return { sunrise: toDate(Jt - w / 360), sunset: toDate(Jt + w / 360) };
  }

  // Giai đoạn trong ngày theo mặt trời
  function phase(now, sun) {
    if (!sun) return "ngay";
    const t = now.getTime(), m = 60000;
    const sr = sun.sunrise.getTime(), ss = sun.sunset.getTime();
    if (t >= sr - 40 * m && t < sr + 50 * m) return "binh-minh";
    if (t >= sr + 50 * m && t < ss - 60 * m) return "ngay";
    if (t >= ss - 60 * m && t < ss + 40 * m) return "hoang-hon";
    return "dem";
  }
  const PHASE_NAME = { "binh-minh": "Bình minh", ngay: "Ban ngày", "hoang-hon": "Hoàng hôn", dem: "Đêm" };

  // Pha trăng theo ngày âm (1 = trăng non, 15 = trăng tròn)
  const moonPhase = lunarDay => ((lunarDay - 1) % 29.5306) / 29.5306;
  function moonName(lunarDay) {
    if (lunarDay <= 2 || lunarDay >= 29) return "Trăng non";
    if (lunarDay < 7) return "Trăng lưỡi liềm";
    if (lunarDay < 10) return "Trăng bán nguyệt đầu tháng";
    if (lunarDay < 14) return "Trăng khuyết sắp tròn";
    if (lunarDay <= 16) return "Trăng tròn";
    if (lunarDay < 21) return "Trăng khuyết sau rằm";
    if (lunarDay < 24) return "Trăng bán nguyệt cuối tháng";
    return "Trăng tàn";
  }

  // Mã thời tiết WMO (Open-Meteo) sang loại hiệu ứng và mô tả tiếng Việt
  function weatherInfo(code) {
    const c = Number(code);
    if (c === 0) return { kind: "clear", text: "Trời quang" };
    if (c === 1) return { kind: "clear", text: "Trời gần như quang" };
    if (c === 2) return { kind: "partly", text: "Mây rải rác" };
    if (c === 3) return { kind: "cloudy", text: "Trời nhiều mây" };
    if (c === 45 || c === 48) return { kind: "fog", text: "Sương mù" };
    if (c >= 51 && c <= 57) return { kind: "rain", text: "Mưa phùn" };
    if (c >= 61 && c <= 65) return { kind: "rain", text: c === 61 ? "Mưa nhẹ" : (c === 63 ? "Mưa vừa" : "Mưa to") };
    if (c === 66 || c === 67) return { kind: "rain", text: "Mưa lạnh" };
    if (c >= 71 && c <= 77) return { kind: "snow", text: "Tuyết rơi" };
    if (c >= 80 && c <= 82) return { kind: "rain", text: c === 82 ? "Mưa rào lớn" : "Mưa rào" };
    if (c === 85 || c === 86) return { kind: "snow", text: "Tuyết rào" };
    if (c >= 95) return { kind: "storm", text: "Dông sét" };
    return { kind: "cloudy", text: "Chưa rõ" };
  }

  root.ThienCo = { lunar, canhGio, sunTimes, phase, PHASE_NAME, moonPhase, moonName, weatherInfo, CHI, CAN, THU, solar2lunar, canChiDay, canChiYear };
})(typeof window !== "undefined" ? window : globalThis);
