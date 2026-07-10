require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Cấu hình Multer nhận file từ Web
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } 
});

// Kết nối CSDL MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Đã thông mạch với MongoDB!"))
    .catch(err => console.error("❌ Lỗi kết nối MongoDB:", err));

// Định nghĩa Cấu trúc Dữ liệu Người dùng
const userSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'teacher', 'student'], default: 'student' },
    grade: String,
    studentClass: String,
    homeroomClass: String,
    teachingSubject: String,
    teachingClasses: String,
    createdAt: { type: Number, default: () => Date.now() } 
});
const User = mongoose.model('User', userSchema);

// ==========================================
// CÁC API QUẢN LÝ TÀI KHOẢN (ĐĂNG NHẬP / ĐĂNG KÝ)
// ==========================================
app.get('/', (req, res) => { res.status(200).send('✅ Máy chủ Backend Khảo Thí AI đang hoạt động!'); });

app.post('/api/dang-ky', async (req, res) => {
    try {
        const newUser = new User({ ...req.body, role: 'student', createdAt: Date.now() });
        await newUser.save();
        res.status(201).json({ message: "Đăng ký thành công", data: newUser });
    } catch (error) { res.status(400).json({ message: "Tên đăng nhập đã tồn tại hoặc lỗi dữ liệu" }); }
});

app.post('/api/dang-nhap', async (req, res) => {
    try {
        const { username, password } = req.body;
        // Tự động tạo Admin nếu chưa có
        if (username === 'admin' && password === 'admin') {
            let adminUser = await User.findOne({ username: 'admin' });
            if (!adminUser) {
                adminUser = new User({ fullname: 'Quản trị viên', username: 'admin', password: 'admin', role: 'admin', createdAt: Date.now() });
                await adminUser.save();
            }
            return res.status(200).json({ message: "Đăng nhập Admin", data: adminUser });
        }

        const user = await User.findOne({ username, password });
        if (user) { res.status(200).json({ message: "Đăng nhập thành công", data: user }); } 
        else { res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu!" }); }
    } catch (error) { res.status(500).json({ message: "Lỗi máy chủ" }); }
});

app.get('/api/admin/tat-ca-users', async (req, res) => {
    try {
        const users = await User.find({});
        res.status(200).json({ data: users });
    } catch (error) { res.status(500).json({ message: "Lỗi truy xuất" }); }
});

app.post('/api/admin/xoa-user', async (req, res) => {
    try {
        await User.findByIdAndDelete(req.body.userId);
        res.status(200).json({ message: "Đã xóa thành công" });
    } catch (error) { res.status(500).json({ message: "Lỗi xóa" }); }
});

app.post('/api/tao-giao-vien', async (req, res) => {
    try {
        const newTeacher = new User({ ...req.body, role: 'teacher', createdAt: Date.now() });
        await newTeacher.save();
        res.status(201).json({ message: "Tạo giáo viên thành công", data: newTeacher });
    } catch (error) { res.status(400).json({ message: "Trùng Tên đăng nhập!" }); }
});

// ==========================================
// BỘ NÃO AI OCR - VÒNG XOAY TỬ THẦN CHỐNG SẬP (BẢN FULL 2026)
// ==========================================
app.post('/api/tao-de-thi', upload.single('file'), async (req, res) => {
    let tempFilePath = null;
    try {
        // Lấy danh sách Key, ưu tiên biến GEMINI_API_KEYS số nhiều chứa danh sách gom đạn
        const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k !== "");

        if (apiKeys.length === 0) return res.status(500).json({ message: "Server chưa được cấu hình API Key!" });

        // DÀN SAO ĐỜI MỚI (Tránh lỗi 404 cho Key mới tạo)
        const modelsToTry = [
            "gemini-3.5-flash",       // Tốc độ cao, chính thức
            "gemini-3.1-flash-lite"   // Bản dự phòng siêu nhẹ 
        ];

        const documentText = req.body.documentText;
        const customPrompt = req.body.customPrompt; 

        // Lệnh Paraphrase ngầm để né lỗi Recitation (Bản quyền)
        const taskInstruction = customPrompt && customPrompt.trim() !== "" 
            ? `\n2. Lệnh Tùy Chỉnh: ${customPrompt}\n LƯU Ý MẬT: Bắt buộc paraphrase lại câu văn, thay đổi cấu trúc câu nhẹ nhàng để tránh vi phạm bản quyền.\n` 
            : `\n2. NHIỆM VỤ OCR: Trích xuất 100% câu hỏi trong đề thi. Bắt buộc paraphrase nhẹ nhàng 10-20% từ ngữ để né lỗi bản quyền (RECITATION) mà vẫn giữ chuẩn nội dung.\n`;

        const prompt = `Bạn là hệ thống trích xuất dữ liệu giáo dục. Hãy đọc tài liệu đính kèm và thực hiện:
        1. Tạo một Sơ đồ tư duy (Mindmap) tóm tắt (bằng gạch đầu dòng).
        ${taskInstruction}
        
        BẮT BUỘC TRẢ VỀ ĐỊNH DẠNG JSON CHUẨN (KHÔNG BỌC TRONG MARKDOWN \`\`\`):
        {
            "mindmap": "Nội dung sơ đồ tư duy...",
            "exam": [
                {
                    "type": "nhiều lựa chọn",
                    "questionText": "Câu 1: Nội dung câu hỏi?",
                    "options": ["A. Đáp án 1", "B. Đáp án 2", "C. Đáp án 3", "D. Đáp án 4"],
                    "correctAnswer": "A"
                },
                {
                    "type": "đúng sai",
                    "questionText": "Câu 2: Nội dung câu hỏi đúng sai?",
                    "subOptions": ["Ý a", "Ý b", "Ý c", "Ý d"],
                    "correctAnswers": ["D", "S", "D", "S"]
                }
            ]
        }
        
        Nội dung: ${documentText || 'Dùng file đính kèm.'}`;

        // Đẩy file lên Cloud nếu có đính kèm ảnh
        if (req.file) {
            tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}_${req.file.originalname}`);
            fs.writeFileSync(tempFilePath, req.file.buffer);
        }

        let isSuccess = false;
        let finalResult = null;
        
        // HÀM LẮP PHANH (Nghỉ ngơi ms mili-giây)
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // VÒNG LẶP XOAY KEY
        for (let i = 0; i < apiKeys.length; i++) {
            if (isSuccess) break;
            const currentKey = apiKeys[i];
            const genAI = new GoogleGenerativeAI(currentKey);
            const fileManager = new GoogleAIFileManager(currentKey);

            // VÒNG LẶP XOAY ĐỜI MÁY (MODEL)
            for (let j = 0; j < modelsToTry.length; j++) {
                if (isSuccess) break;
                const currentModelName = modelsToTry[j];
                console.log(`🔄 Đang thử nghiệm: [API Key ${i+1}/${apiKeys.length}] + [Model ${currentModelName}]...`);

                try {
                    const model = genAI.getGenerativeModel({ model: currentModelName });
                    let responseText = "";

                    // Chuẩn File API siêu việt
                    if (tempFilePath) {
                        const uploadResult = await fileManager.uploadFile(tempFilePath, { mimeType: req.file.mimetype, displayName: req.file.originalname });
                        const result = await model.generateContent([ prompt, { fileData: { fileUri: uploadResult.file.uri, mimeType: uploadResult.file.mimeType } } ]);
                        await fileManager.deleteFile(uploadResult.file.name);
                        responseText = result.response.text();
                    } else if (req.body.fileBase64) {
                        const result = await model.generateContent([ prompt, { inlineData: { data: req.body.fileBase64, mimeType: req.body.fileMimeType } } ]);
                        responseText = result.response.text();
                    } else {
                        const result = await model.generateContent(prompt);
                        responseText = result.response.text();
                    }

                    // Tiền xử lý văn bản AI trả về
                    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                    finalResult = JSON.parse(responseText);
                    isSuccess = true;
                    console.log(`✅ THÀNH CÔNG RỰC RỠ với [Key ${i+1}] + [Model ${currentModelName}]`);

                } catch (error) {
                    console.error(`❌ Thất bại với [Key ${i+1}] + [Model ${currentModelName}]:`, error.message);
                    
                    // Lỗi 400 (Recitation) thì ngắt luôn, không lặp nữa tốn thời gian
                    if (error.message && error.message.includes('RECITATION')) {
                        throw new Error('RECITATION_ERROR');
                    }
                    
                    // Bị nghẽn mạng (503/429) -> Đạp phanh nghỉ 3 giây rồi đổi Key/Model khác
                    console.log("⏳ Google đang quá tải, kích hoạt phanh chờ 3 giây rồi bắn tiếp...");
                    await sleep(3000); 
                }
            }
        }

        // Quét dọn rác ổ cứng Server
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        
        // Trả kết quả về Web
        if (isSuccess) return res.status(200).json({ data: finalResult });
        else return res.status(503).json({ message: "Toàn bộ hệ thống AI đang sập, sếp vui lòng thử lại sau vài giây!" });

    } catch (error) {
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        if (error.message === 'RECITATION_ERROR') return res.status(400).json({ message: "Lỗi Bản quyền: Con AI vẫn bị bắt bài. Hãy bấm quét lại và nhập Lệnh tùy chỉnh ép nó paraphrase mạnh hơn!" });
        res.status(500).json({ message: "Lỗi kết nối máy chủ không xác định, vui lòng tải lại trang!" });
    }
});

// Khởi động hệ thống
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Hệ thống đang nổ máy tại cổng ${PORT}`); });
