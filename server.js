require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// Bật CORS để cho phép web gọi vào Railway
app.use(cors());

// Nới lỏng cổng thành lên 50MB để nhận file ảnh gộp nặng
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Cài đặt Multer: Dùng RAM làm bộ đệm
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } 
});

// Khởi tạo Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ==========================================
// 1. KẾT NỐI DATABASE MONGODB
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Đã thông mạch với MongoDB!"))
    .catch(err => console.error("❌ Lỗi kết nối MongoDB:", err));

// ==========================================
// 2. TẠO CẤU TRÚC LƯU TRỮ (MODEL)
// ==========================================
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
// 3. API KHỞI ĐỘNG VÀ QUẢN LÝ USER
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
// 4. BỘ NÃO AI NHẬN DIỆN 100% TEXT
// ==========================================
app.post('/api/tao-de-thi', upload.single('file'), async (req, res) => {
    try {
        const documentText = req.body.documentText;
        let fileBase64 = req.body.fileBase64; 
        let fileMimeType = req.body.fileMimeType;
        const customPrompt = req.body.customPrompt; 

        if (req.file) {
            fileBase64 = req.file.buffer.toString('base64');
            fileMimeType = req.file.mimetype;
        }

        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

        // LỆNH ÉP AI SCAN 100% DỮ LIỆU CHỮ (KHÔNG BỎ BỚT)
        const taskInstruction = customPrompt && customPrompt.trim() !== "" 
            ? `\n2. Lệnh Tùy Chỉnh: ${customPrompt}\n` 
            : `\n2. ĐÂY LÀ NHIỆM VỤ SỐ HÓA OCR (DATA ENTRY). Hãy trích xuất 100% CÁC CÂU HỎI TRONG ĐỀ THI. Giữ nguyên 100% cấu trúc, nội dung chữ, đáp án. Nếu có bảng đáp án đính kèm thì ghép luôn đáp án đúng vào câu đó. Quét toàn bộ đề, không được tự ý bỏ câu nào.\n`;

        const prompt = `Bạn là hệ thống trích xuất dữ liệu. Hãy đọc tài liệu/hình ảnh đính kèm và thực hiện:
        1. Tạo một Sơ đồ tư duy (Mindmap) tóm tắt chủ đề của đề thi này (bằng gạch đầu dòng).
        ${taskInstruction}
        
        BẮT BUỘC TRẢ VỀ ĐỊNH DẠNG JSON CHUẨN (KHÔNG MARKDOWN):
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

        let result;
        if (fileBase64) {
            result = await model.generateContent([
                prompt,
                { inlineData: { data: fileBase64, mimeType: fileMimeType } }
            ]);
        } else {
            result = await model.generateContent(prompt);
        }

        let responseText = result.response.text();
        responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const aiResult = JSON.parse(responseText);

        res.status(200).json({ data: aiResult });

    } catch (error) {
        console.error("❌ Lỗi AI:", error);
        
        // Bắt chính xác lỗi Bản quyền để báo lên Web
        if (error.message && error.message.includes('RECITATION')) {
            return res.status(400).json({ message: "Bộ lọc bản quyền Google (Recitation) đã chặn vì copy y chang đề trên mạng. Sếp hãy nhập thêm vào ô Lệnh AI Tùy Chỉnh: 'Đảo vị trí các từ một chút xíu' nhé!" });
        }
        res.status(500).json({ message: "Google AI đang bị ngợp hoặc định dạng lỗi, sếp nạp lại thử nhé!" });
    }
});

// ==========================================
// 5. KHỞI ĐỘNG MÁY CHỦ
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Hệ thống đang nổ máy tại cổng ${PORT}`); });
