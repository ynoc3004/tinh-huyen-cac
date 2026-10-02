// Áp font tiêu đề đã chọn ở trang "Đổi font tiêu đề" cho mọi trang.
try {
  const f = localStorage.getItem("titleFont");
  if (f) {
    const r = document.documentElement.style;
    r.setProperty("--title", f);
    r.setProperty("--tw", "400");
  }
} catch (e) {}
