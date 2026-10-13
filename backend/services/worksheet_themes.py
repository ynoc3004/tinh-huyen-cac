"""Vietnamese worksheet taxonomy using Lichess's exact theme/opening tags."""
THEME_GROUPS = [
    {"name": "Chiếu hết theo số nước", "items": [
        ("mate", "Chiếu hết"), ("mateIn1", "Chiếu hết trong 1 nước"),
        ("mateIn2", "Chiếu hết trong 2 nước"), ("mateIn3", "Chiếu hết trong 3 nước"),
        ("mateIn4", "Chiếu hết trong 4 nước"), ("mateIn5", "Chiếu hết trong 5 nước trở lên")]},
    {"name": "Các kiểu chiếu hết", "items": [
        ("backRankMate", "Chiếu hết hàng cuối"), ("smotheredMate", "Chiếu hết ngạt"),
        ("anastasiaMate", "Chiếu hết Anastasia"), ("arabianMate", "Chiếu hết Arabian"),
        ("bodenMate", "Chiếu hết Boden"), ("doubleBishopMate", "Chiếu hết hai tượng"),
        ("dovetailMate", "Chiếu hết Dovetail"), ("hookMate", "Chiếu hết Hook"),
        ("killBoxMate", "Chiếu hết Kill Box"), ("swallowstailMate", "Chiếu hết đuôi én"),
        ("vukovicMate", "Chiếu hết Vuković"), ("balestraMate", "Chiếu hết Balestra"),
        ("blindSwineMate", "Chiếu hết hai xe (Blind Swine)"), ("cornerMate", "Chiếu hết ở góc"),
        ("epauletteMate", "Chiếu hết Epaulette"), ("morphysMate", "Chiếu hết Morphy"),
        ("operaMate", "Chiếu hết Opera"), ("pillsburysMate", "Chiếu hết Pillsbury"),
        ("triangleMate", "Chiếu hết tam giác")]},
    {"name": "Khai cuộc", "items": [
        ("opening", "Chiến thuật trong khai cuộc"),
        ("opening:French_Defense", "Phòng thủ Pháp (French)"),
        ("opening:Ruy_Lopez", "Khai cuộc Tây Ban Nha (Ruy Lopez)"),
        ("opening:Sicilian_Defense", "Phòng thủ Sicilian"),
        ("opening:Caro-Kann_Defense", "Phòng thủ Caro-Kann"),
        ("opening:Indian_Defense", "Phòng thủ Ấn Độ (Indian)"),
        ("opening:Italian_Game", "Khai cuộc Ý (Italian)"),
        ("opening:Queens_Gambit_Declined", "Gambit Hậu từ chối"),
        ("opening:Queens_Pawn_Game", "Khai cuộc tốt Hậu"),
        ("opening:English_Opening", "Khai cuộc Anh (English)"),
        ("opening:Russian_Game", "Phòng thủ Nga (Petrov)"),
        ("opening:Philidor_Defense", "Phòng thủ Philidor"),
        ("opening:Scandinavian_Defense", "Phòng thủ Scandinavian"),
        ("opening:Scotch_Game", "Khai cuộc Scotland (Scotch)"),
        ("opening:Modern_Defense", "Phòng thủ Hiện đại (Modern)"),
        ("opening:Four_Knights_Game", "Khai cuộc bốn mã"),
        ("opening:Kings_Gambit_Accepted", "Gambit Vua chấp nhận"),
        ("opening:Pirc_Defense", "Phòng thủ Pirc"),
        ("opening:Kings_Pawn_Game_Damiano_Defense", "Phòng thủ Damiano"),
        ("opening:Rapport-Jobava_System", "Hệ thống Rapport-Jobava"),
        ("opening:Vienna_Game", "Khai cuộc Vienna"),
        ("opening:Queens_Pawn_Game_Accelerated_London_System", "Hệ thống London")]},
    {"name": "Đòn chiến thuật", "items": [
        ("fork", "Đòn đôi"), ("pin", "Ghim quân"), ("skewer", "Xiên quân"),
        ("discoveredAttack", "Tấn công mở"), ("discoveredCheck", "Chiếu mở"),
        ("doubleCheck", "Chiếu đôi"), ("attraction", "Thu hút quân"),
        ("xRayAttack", "Tấn công xuyên tia (X-Ray)"), ("deflection", "Đánh lạc hướng"),
        ("hangingPiece", "Bắt quân không được bảo vệ"), ("sacrifice", "Hy sinh"),
        ("interference", "Cản đường phòng thủ"), ("trappedPiece", "Bẫy quân"),
        ("capturingDefender", "Loại bỏ quân phòng thủ"), ("clearance", "Giải phóng đường / ô"),
        ("exposedKing", "Vua bị lộ"), ("kingsideAttack", "Tấn công cánh Vua"),
        ("queensideAttack", "Tấn công cánh Hậu"), ("attackingF2F7", "Tấn công f2 / f7")]},
    {"name": "Tính toán và phòng thủ", "items": [
        ("defensiveMove", "Nước phòng thủ"), ("quietMove", "Nước đi yên lặng"),
        ("intermezzo", "Nước trung gian"), ("collinearMove", "Nước đi trên đường đối đầu"),
        ("zugzwang", "Cưỡng bức phải đi (Zugzwang)")]},
    {"name": "Trung cuộc và tàn cuộc", "items": [
        ("middlegame", "Trung cuộc"), ("endgame", "Tàn cuộc"),
        ("pawnEndgame", "Tàn cuộc tốt"), ("rookEndgame", "Tàn cuộc xe"),
        ("bishopEndgame", "Tàn cuộc tượng"), ("knightEndgame", "Tàn cuộc mã"),
        ("queenEndgame", "Tàn cuộc hậu"), ("queenRookEndgame", "Tàn cuộc hậu và xe"),
        ("advancedPawn", "Tốt tiến sâu")]},
    {"name": "Nước đi đặc biệt", "items": [
        ("enPassant", "Bắt tốt qua đường"), ("underPromotion", "Phong cấp thành xe / tượng / mã"),
        ("castling", "Nhập thành"), ("promotion", "Phong cấp")]},
    {"name": "Độ dài bài", "items": [
        ("oneMove", "Bài một nước đi"), ("short", "Bài ngắn (2 nước)"),
        ("long", "Bài dài (3 nước)"), ("veryLong", "Bài rất dài (4 nước trở lên)")]},
    {"name": "Mục tiêu", "items": [
        ("advantage", "Giành ưu thế"), ("crushing", "Ưu thế quyết định"),
        ("equality", "Cân bằng / cứu hòa")]},
    {"name": "Nguồn ván đấu", "items": [
        ("master", "Ván đấu của kiện tướng"), ("masterVsMaster", "Kiện tướng đấu kiện tướng"),
        ("superGM", "Ván đấu của siêu đại kiện tướng")]},
]
THEMES = {"": "Mọi chủ đề", **{key: label for group in THEME_GROUPS for key, label in group["items"]}}


def grouped_themes():
    return [{"name": group["name"], "ids": [key for key, _ in group["items"]]} for group in THEME_GROUPS]


def theme_field(theme):
    return ("opening_tags", theme[len("opening:"):]) if theme.startswith("opening:") else ("themes", theme)


def theme_keys(themes, opening_tags):
    return set(themes.split()) | {"opening:" + tag for tag in opening_tags.split()}
