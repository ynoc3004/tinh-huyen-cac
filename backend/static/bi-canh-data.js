// Công pháp (đòn chiến thuật) mang tên huyền môn, đối thủ luận kiếm và lời thoại. Khóa của công pháp trùng với tên chủ đề của Lichess.
export const TECHS = [
  { key: "mate", name: "Trảm Long Quyết", plain: "Chiếu hết", essence: "Dồn vua địch vào thế không còn đường thoát. Một nhát kiếm kết thúc ván cờ." },
  { key: "fork", name: "Song Kiếm Tề Xuất", plain: "Đòn đôi", essence: "Một quân cùng lúc đánh hai mục tiêu. Địch chỉ cứu được một, quân còn lại thuộc về ta." },
  { key: "pin", name: "Định Thân Chú", plain: "Ghim", essence: "Quân địch bị định thân tại chỗ, vì đứng sau nó là quân quan trọng hơn. Nó đi thì mất quân sau." },
  { key: "skewer", name: "Xuyên Tâm Kiếm", plain: "Đòn xiên", essence: "Ép quân lớn phải tránh đi, rồi ăn quân đứng ngay sau nó. Ngược lại với ghim." },
  { key: "discoveredAttack", name: "Ẩn Kiếm Xuất Phong", plain: "Đòn lộ", essence: "Dời một quân để lộ đường tấn công của quân phía sau. Một nước đi, hai mối đe dọa." },
  { key: "doubleCheck", name: "Song Thiên Sát", plain: "Chiếu kép", essence: "Hai quân cùng chiếu vua một lúc. Không thể chặn hay ăn cả hai, vua buộc phải chạy." },
  { key: "sacrifice", name: "Xả Thân Chứng Đạo", plain: "Hy sinh", essence: "Chủ động bỏ quân để đổi lấy thế chiếu hết hoặc lợi thế lớn hơn nhiều." },
  { key: "deflection", name: "Điệu Hổ Ly Sơn", plain: "Dẫn dụ", essence: "Ép quân đang canh giữ điểm trọng yếu phải rời vị trí, rồi ta đánh vào chỗ vừa bỏ trống." },
  { key: "attraction", name: "Dẫn Xà Xuất Động", plain: "Thu hút", essence: "Dụ quân địch, thường là vua, bước vào ô nguy hiểm bằng một đòn hy sinh." },
  { key: "trappedPiece", name: "Thiên La Địa Võng", plain: "Bẫy quân", essence: "Quân địch bị nhốt, mọi đường thoát đều bị chặn hoặc đều dẫn đến mất quân." },
  { key: "hangingPiece", name: "Nhặt Linh Thạch", plain: "Quân treo", essence: "Quân địch không ai bảo vệ. Chỉ cần nhìn kỹ là thu được." },
  { key: "capturingDefender", name: "Phá Hộ Pháp", plain: "Ăn quân bảo vệ", essence: "Loại quân đang bảo vệ mục tiêu, rồi mục tiêu tự rơi vào tay ta." },
  { key: "quietMove", name: "Vô Thanh Nhất Chỉ", plain: "Nước tĩnh", essence: "Một nước không ăn quân, không chiếu, nhưng khiến địch bó tay trước mối đe dọa kế tiếp." },
  { key: "defensiveMove", name: "Kim Chung Tráo", plain: "Nước phòng thủ", essence: "Tìm đúng nước đỡ duy nhất để sống sót qua đòn công của địch." },
  { key: "intermezzo", name: "Nghịch Chiêu Đoạt Cơ", plain: "Nước chen", essence: "Chen vào một nước ép, thường là chiếu, trước khi làm việc đang định làm. Địch phải trả lời trước." },
  { key: "backRankMate", name: "Đoạn Hậu Sát", plain: "Chiếu hết hàng cuối", essence: "Vua kẹt sau hàng tốt của chính mình. Xe hoặc hậu giáng xuống hàng cuối là hết đường." },
  { key: "smotheredMate", name: "Tự Bế Sát", plain: "Chiếu hết bí", essence: "Vua bị chính quân mình vây kín, một nước của Mã là kết liễu." },
  { key: "kingsideAttack", name: "Phá Hộ Sơn Đại Trận", plain: "Tấn công cánh vua", essence: "Dồn lực phá vỡ trận phòng thủ quanh vua đã nhập thành." },
  { key: "exposedKing", name: "Thiên Môn Đại Khai", plain: "Vua hở", essence: "Vua mất lớp bảo vệ, mọi đòn công đều có sức nặng. Hãy tìm đường chiếu liên tục." },
  { key: "promotion", name: "Phi Thăng", plain: "Phong cấp", essence: "Đưa tốt xuống cuối bàn để hóa thành quân mạnh, thường là Hậu." },
  { key: "zugzwang", name: "Tiến Thoái Lưỡng Nan", plain: "Zugzwang", essence: "Đến lượt đi lại là thiệt. Mọi nước của địch đều làm thế cờ xấu đi." },
  { key: "endgame", name: "Tàn Cục Ngộ Đạo", plain: "Tàn cuộc", essence: "Ít quân, nên từng nước đều quyết định. Vua cũng là một quân chiến đấu." },
  { key: "clearance", name: "Khai Lộ Quyết", plain: "Dọn đường", essence: "Dời quân để mở đường, giải phóng ô hoặc đường tấn công cho quân khác." },
  { key: "interference", name: "Đoạn Mạch Chú", plain: "Can thiệp", essence: "Đặt quân vào giữa để cắt đường liên lạc hoặc bảo vệ của đối phương." },
  { key: "xRayAttack", name: "Xuyên Ảnh Quyết", plain: "Đòn Tia X", essence: "Tấn công hoặc bảo vệ xuyên qua một quân đang chắn trên cùng đường." }
];
export const TECH_GROUPS = [
  { key: "outer", name: "Công pháp ngoại môn", note: "Đòn chiến thuật cơ bản", icon: "♙" },
  { key: "inner", name: "Công pháp nội môn", note: "Phối hợp và chiến thuật nâng cao", icon: "♘" },
];
const INNER_KEYS = new Set(["sacrifice","deflection","attraction","quietMove","defensiveMove","intermezzo","zugzwang","clearance","interference","xRayAttack"]);
TECHS.forEach(t => { t.group = INNER_KEYS.has(t.key) ? "inner" : "outer"; });
export const TECH_BY_KEY = Object.fromEntries(TECHS.map(t => [t.key, t]));
// Các nhãn khác của Lichess, dùng cho dòng "chủ đề khác" sau khi giải xong
export const PLAIN = {
  mateIn1: "Chiếu hết 1 nước", mateIn2: "Chiếu hết 2 nước", mateIn3: "Chiếu hết 3 nước", mateIn4: "Chiếu hết 4 nước", mateIn5: "Chiếu hết 5 nước",
  short: "Ngắn", long: "Dài", veryLong: "Rất dài", oneMove: "Một nước", middlegame: "Trung cuộc", opening: "Khai cuộc", advantage: "Giành lợi thế",
  crushing: "Áp đảo", equality: "Gỡ hòa", queensideAttack: "Tấn công cánh hậu", clearance: "Dọn đường", interference: "Chặn đường", xRayAttack: "Tia X", advancedPawn: "Tốt tiến xa",
};
// Đối thủ luận kiếm theo cảnh giới (điểm hiển thị chỉ là ước chừng)
export const BOTS = [
  { realm: "Phàm Nhân", name: "Đồng tử gác núi", show: 700, skill: 0, depth: 1, ms: 120 },
  { realm: "Luyện Khí", name: "Sư huynh ngoại môn", show: 1000, skill: 3, depth: 3, ms: 250 },
  { realm: "Trúc Cơ", name: "Trưởng lão chấp pháp", show: 1350, elo: 1350, ms: 400 },
  { realm: "Kim Đan", name: "Chân nhân Kim Đan", show: 1650, elo: 1650, ms: 500 },
  { realm: "Nguyên Anh", name: "Lão tổ Nguyên Anh", show: 1950, elo: 1950, ms: 600 },
  { realm: "Hóa Thần", name: "Chí tôn Hóa Thần", show: 2350, elo: 2350, ms: 700 },
];
export const SPEECH = {
  idle: ["Chọn đối thủ, rồi mời ra tay.", "Luận kiếm không phân sống chết, chỉ phân cao thấp."],
  start: ["Đạo hữu, mời xuất chiêu.", "Nơi này không dung kẻ nóng vội.", "Một ván cờ, một lần bế quan. Bắt đầu thôi."],
  check: ["Hừ, chiêu này không tồi!", "Vua của ta bị động rồi sao?", "Khá lắm, nhưng chưa đủ."],
  capture: ["Quân của ta... được lắm.", "Một quân đổi một quân, đạo hữu tính toán rồi chứ?"],
  botWin: ["Đạo tâm chưa vững, về bế quan thêm đi.", "Ván này thuộc về ta. Đạo hữu cứ rút kinh nghiệm."],
  botLose: ["Lão phu bái phục. Hẹn ngày tái chiến.", "Hậu sinh khả úy. Ta thua tâm phục."],
  draw: ["Hòa. Hai bên đều chưa phân thắng bại.", "Ngang tài ngang sức, hẹn ván sau."],
  resign: ["Biết lui là biết tiến. Hẹn gặp lại."],
};
