import SwiftUI
import Vision

/// The sorts of thing, space and service rab knows, under each kind: the same
/// slugs the website has (src/utils/kinds.js), since the server keeps the slug
/// and the website shows its name. Nobody picks one here to begin with — the
/// phone looks at the photo and the name and suggests it (see `suggest`).
enum Categories {
    static let all: [Kind: [String]] = [
        .item: ["car", "bike", "camera", "video-camera", "drone", "binoculars", "projector", "3d-printer", "audio", "computer", "game-console", "electronics", "kitchen-appliance", "cleaning-appliance", "beauty-appliance", "tools", "camping", "sports", "clothing", "other"],
        .space: ["home", "meeting-room", "studio", "storage", "event-space", "workspace", "parking", "other"],
        .service: [
            "photography", "teaching", "repair", "moving", "cleaning", "design", "guide", "translation", "music", "fitness", "beauty",
            "massage", "pet-care", "childcare", "care", "cooking", "driver", "delivery", "gardening", "it-support", "programming",
            "videography", "writing", "consulting", "event-help", "handyman", "other",
        ],
    ]

    /// A category's name, as the website says it.
    static func name(_ slug: String) -> LocalizedStringKey {
        LocalizedStringKey(names[slug] ?? slug)
    }

    private static let names: [String: String] = [
        "car": "Car", "bike": "Bike", "camera": "Camera", "video-camera": "Video camera", "projector": "Projector",
        "3d-printer": "3D printer", "audio": "Audio gear", "electronics": "Electronics", "tools": "Tools",
        "drone": "Drone", "binoculars": "Binoculars", "computer": "Computer", "game-console": "Game console",
        "kitchen-appliance": "Kitchen appliances", "cleaning-appliance": "Cleaning appliances", "beauty-appliance": "Beauty appliances",
        "camping": "Camping gear", "sports": "Sports gear", "clothing": "Clothing", "other": "Other",
        "home": "Home", "meeting-room": "Meeting room", "studio": "Studio", "storage": "Storage",
        "event-space": "Event space", "workspace": "Workspace", "parking": "Parking",
        "photography": "Photography", "teaching": "Teaching", "repair": "Repair", "moving": "Moving help",
        "cleaning": "Cleaning", "design": "Design", "guide": "Guide", "translation": "Translation", "music": "Music",
        "fitness": "Fitness", "beauty": "Beauty", "massage": "Massage", "pet-care": "Pet care", "childcare": "Childcare",
        "care": "Care", "cooking": "Cooking", "driver": "Driver", "delivery": "Delivery", "gardening": "Gardening",
        "it-support": "IT support", "programming": "Programming", "videography": "Videography", "writing": "Writing",
        "consulting": "Consulting", "event-help": "Event help", "handyman": "Handyman",
    ]

    /// The words that point at a category: in what Vision calls the things it
    /// sees in a photo (English, lower case, underscores for spaces), and in
    /// the name somebody types, in English, Chinese or Japanese.
    private static let hints: [String: [String]] = [
        // things
        "car": ["car", "automobile", "suv", "truck", "van", "jeep", "vehicle", "汽车", "轿车", "車", "クルマ"],
        "bike": ["bicycle", "bike", "motorcycle", "scooter", "moped", "自行车", "单车", "摩托", "自転車", "バイク"],
        "camera": ["camera", "lens", "tripod", "相机", "镜头", "カメラ", "レンズ"],
        "video-camera": ["camcorder", "video_camera", "video camera", "摄像机", "ビデオカメラ"],
        "projector": ["projector", "投影", "プロジェクター"],
        "3d-printer": ["printer", "3d", "打印机", "プリンター"],
        "audio": ["speaker", "headphone", "microphone", "amplifier", "guitar", "piano", "drum", "violin", "musical_instrument", "audio", "音响", "耳机", "麦克风", "吉他", "スピーカー", "マイク", "ギター"],
        "drone": ["drone", "quadcopter", "无人机", "ドローン"],
        "binoculars": ["binoculars", "telescope", "望远镜", "双眼鏡", "望遠鏡"],
        "computer": ["computer", "laptop", "电脑", "笔记本", "パソコン", "ノートPC"],
        "game-console": ["console", "game_controller", "gamepad", "joystick", "游戏机", "ゲーム機"],
        "electronics": ["phone", "tablet", "television", "monitor", "keyboard", "electronics", "手机", "平板", "电视", "スマホ", "タブレット", "テレビ"],
        "kitchen-appliance": ["microwave", "oven", "toaster", "blender", "rice_cooker", "coffee_maker", "kettle", "电饭煲", "微波炉", "烤箱", "炊飯器", "電子レンジ", "キッチン家電"],
        "cleaning-appliance": ["vacuum", "vacuum_cleaner", "吸尘器", "扫地机", "掃除機", "掃除家電"],
        "beauty-appliance": ["hair_dryer", "hairdryer", "hair dryer", "curling_iron", "吹风机", "卷发棒", "ドライヤー", "ヘアアイロン", "美容家電"],
        "tools": ["tool", "drill", "hammer", "saw", "wrench", "ladder", "screwdriver", "工具", "电钻", "梯子", "ドリル", "はしご"],
        "camping": ["tent", "camping", "sleeping_bag", "backpack", "lantern", "campfire", "帐篷", "露营", "テント", "キャンプ"],
        "sports": ["ball", "ski", "snowboard", "surfboard", "skateboard", "racket", "golf", "kayak", "helmet", "sport", "滑雪", "冲浪", "球拍", "スキー", "サーフ", "ゴルフ"],
        "clothing": ["clothing", "dress", "suit", "jacket", "kimono", "shoe", "coat", "costume", "衣服", "礼服", "西装", "和服", "着物", "ドレス", "スーツ"],
        // spaces
        "home": ["house", "home", "apartment", "bedroom", "living_room", "kitchen", "interior_room", "房子", "公寓", "住宅", "民宿", "部屋", "アパート"],
        "meeting-room": ["conference", "meeting", "会议室", "会議室"],
        "studio": ["studio", "录音棚", "工作室", "スタジオ"],
        "storage": ["storage", "warehouse", "closet", "shed", "仓库", "储物", "倉庫", "収納"],
        "event-space": ["hall", "stage", "ballroom", "venue", "auditorium", "event", "活动场地", "宴会", "イベント", "ホール"],
        "workspace": ["office", "desk", "workspace", "cowork", "办公", "工位", "オフィス", "デスク"],
        "parking": ["parking", "garage", "carport", "车位", "停车", "駐車"],
        // services
        "photography": ["photograph", "photo shoot", "摄影", "拍照", "撮影"],
        "teaching": ["lesson", "teach", "tutor", "class", "教学", "家教", "课程", "レッスン", "教え"],
        "repair": ["repair", "fix", "维修", "修理"],
        "moving": ["moving", "mover", "搬家", "引越"],
        "cleaning": ["cleaning", "cleaner", "清洁", "保洁", "打扫", "掃除", "清掃"],
        "design": ["design", "设计", "デザイン"],
        "guide": ["guide", "tour", "向导", "导游", "ガイド", "案内"],
        "translation": ["translat", "interpret", "翻译", "口译", "翻訳", "通訳"],
        "music": ["music", "band", "dj", "音乐", "演奏", "音楽"],
        "fitness": ["fitness", "yoga", "training", "gym", "健身", "瑜伽", "フィットネス", "ヨガ"],
        "beauty": ["hair", "makeup", "nail", "beauty", "美容", "美发", "化妆", "美甲", "メイク", "ネイル"],
        "massage": ["massage", "按摩", "マッサージ"],
        "pet-care": ["pet", "dog walk", "宠物", "遛狗", "ペット"],
        "childcare": ["childcare", "babysit", "nanny", "育儿", "保姆", "带孩子", "ベビーシッター", "保育"],
        "care": ["elder", "caregiver", "nursing", "护理", "看护", "介護"],
        "cooking": ["cook", "chef", "catering", "做饭", "厨师", "料理"],
        "driver": ["driver", "chauffeur", "司机", "代驾", "運転"],
        "delivery": ["deliver", "courier", "配送", "跑腿", "配達"],
        "gardening": ["garden", "lawn", "园艺", "庭"],
        "it-support": ["it support", "tech support", "电脑维修", "it支持", "itサポート"],
        "programming": ["program", "coding", "developer", "software", "编程", "开发", "プログラミング"],
        "videography": ["videograph", "video shoot", "film", "摄像", "拍视频", "動画撮影"],
        "writing": ["writing", "copywrit", "写作", "文案", "ライティング", "執筆"],
        "consulting": ["consult", "咨询", "顾问", "コンサル"],
        "event-help": ["event staff", "event help", "活动协助", "イベント手伝"],
        "handyman": ["handyman", "odd job", "杂工", "便利屋"],
    ]

    /// The category the photo and the name point at, among those of a kind, or
    /// nil where neither says enough. A word in the name counts for a
    /// certainty. What Vision saw counts for as much as it was sure of it, and
    /// alone it has to be quite sure: its names are broad ("computer" for a
    /// pen on a desk), and a wrong category is worse than none.
    static func suggest(kind: Kind, seen: [Sighting], title: String) -> String? {
        let name = title.lowercased()
        var best: (slug: String, score: Double)?
        for slug in all[kind] ?? [] {
            guard let words = hints[slug] else { continue }
            var score = 0.0
            for word in words {
                if name.contains(word) { score += 1 }
                // Vision's names are single English words joined by underscores:
                // "tent" is a hint in "dome_tent", "car" is not one in "carpet".
                for sighting in seen where sighting.name.split(separator: "_").contains(Substring(word)) || sighting.name == word {
                    score += Double(sighting.confidence)
                }
            }
            if score > (best?.score ?? 0.6) { best = (slug, score) }
        }
        return best?.slug
    }
}

/// Something Vision's classifier saw in a photo, and how sure it was.
struct Sighting: Hashable {
    var name: String
    var confidence: Float
}

/// What is in a photo, by the classifier that ships with the phone: nothing
/// leaves it, and no account or key is needed.
enum PhotoClassifier {
    static func look(at image: UIImage) async -> [Sighting] {
        let source = image.normalized(maxSide: 1024)
        return await Task.detached(priority: .utility) {
            guard let cgImage = source.cgImage else { return [] }
            let request = VNClassifyImageRequest()
            do {
                try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
            } catch {
                return []
            }
            return (request.results ?? [])
                .filter { $0.confidence >= 0.1 }
                .prefix(20)
                .map { Sighting(name: $0.identifier.lowercased(), confidence: $0.confidence) }
        }.value
    }
}
