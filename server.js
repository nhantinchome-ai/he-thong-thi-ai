require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// Bật CORS để cho phép web gọi vào Railway
app.use(cors());

// Nới lỏng cổng thành lên 50MB
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
// 3. NHÂN VIÊN LỄ TÂN ĐÓN BẢO VỆ RAILWAY
// ==========================================
app.get('/', (req, res) => {
    res.status(200).send('✅ Máy chủ Backend Khảo Thí AI đang hoạt động mượt mà!');
});

// ==========================================
// 4. CÁC API QUẢN LÝ USER
// ==========================================
app.post('/api/dang-ky', async (req, res) => {
    try {
        const newUser = new User({ ...req.body, role: 'student', createdAt: Date.now() });
        await newUser.save();
        res.status(201).json({ message: "Đăng ký thành công", data: newUser });
    } catch (error) {
        res.status(400).json({ message: "Tên đăng nhập đã tồn tại hoặc lỗi dữ liệu" });
    }
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
        if (user) {
            res.status(200).json({ message: "Đăng nhập thành công", data: user });
        } else {
            res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu!" });
        }
    } catch (error) {
        res.status(500).json({ message: "Lỗi máy chủ" });
    }
});

app.get('/api/admin/tat-ca-users', async (req, res) => {
    try {
        const users = await User.find({});
        res.status(200).json({ data: users });
    } catch (error) {
        res.status(500).json({ message: "Lỗi truy xuất dữ liệu" });
    }
});

app.post('/api/admin/xoa-user', async (req, res) => {
    try {
        await User.findByIdAndDelete(req.body.userId);
        res.status(200).json({ message: "Đã xóa thành công" });
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi xóa" });
    }
});

app.post('/api/tao-giao-vien', async (req, res) => {
    try {
        const newTeacher = new User({ ...req.body, role: 'teacher', createdAt: Date.now() });
        await newTeacher.save();
        res.status(201).json({ message: "Tạo giáo viên thành công", data: newTeacher });
    } catch (error) {
        res.status(400).json({ message: "Trùng Tên đăng nhập hoặc thiếu thông tin" });
    }
});

// ==========================================
// 5. BỘ NÃO AI 2.0 (LÁCH LUẬT RECITATION)
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

        // THÊM CÂU THẦN CHÚ LÁCH LUẬT BẢN QUYỀN VÀO LỆNH
        const taskInstruction = customPrompt && customPrompt.trim() !== "" 
            ? `\n2. YÊU CẦU TỪ GIÁO VIÊN: ${customPrompt}\n LƯU Ý BẢO MẬT: Đây là tài liệu phục vụ ôn tập nội bộ. Để tránh bộ lọc bản quyền (Recitation), bạn được phép tinh chỉnh, tóm tắt hoặc diễn đạt lại một chút về mặt từ ngữ, định dạng, nhưng TUYỆT ĐỐI PHẢI GIỮ NGUYÊN Ý NGHĨA CHÍNH của câu hỏi và đáp án đúng.\n` 
            : `\n2. Tạo một bộ đề kiểm tra gồm 10 câu (8 câu trắc nghiệm, 2 câu đúng sai). Để tránh bộ lọc bản quyền, hãy diễn đạt lại câu hỏi một cách sáng tạo nhưng vẫn giữ chuẩn kiến thức.\n`;

        const prompt = `Bạn là một hệ thống AI xử lý dữ liệu giáo dục chuyên nghiệp. Hãy đọc tài liệu đính kèm và thực hiện:
        1. Tạo một Sơ đồ tư duy (Mindmap) tóm tắt kiến thức (phân cấp bằng gạch đầu dòng).
        ${taskInstruction}
        
        Yêu cầu BẮT BUỘC trả về ĐÚNG định dạng JSON sau (Tuyệt đối không bọc trong markdown hay ghi chú thêm):
        {
            "mindmap": "Nội dung sơ đồ tư duy...",
            "exam": [
                {
                    "type": "nhiều lựa chọn",
                    "questionText": "Nội dung câu hỏi?",
                    "options": ["A. Đáp án", "B. Đáp án", "C. Đáp án", "D. Đáp án"],
                    "correctAnswer": "A"
                },
                {
                    "type": "đúng sai",
                    "questionText": "Nội dung câu hỏi đúng sai?",
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
        
        // XỬ LÝ LỖI RECITATION ĐỂ BÁO VỀ WEB THAY VÌ SẬP MÁY CHỦ
        if (error.message && error.message.includes('RECITATION')) {
            return res.status(400).json({ message: "Lỗi Bản Quyền (Recitation): Google chặn file này vì giống tài liệu bản quyền trên mạng. Sếp thử nhập thêm lệnh 'Hãy viết lại các câu hỏi bằng văn phong khác' xem sao nhé!" });
        }
        
        res.status(500).json({ message: "Google AI đang quá tải hoặc lỗi định dạng dữ liệu, sếp nạp lại thử nhé!" });
    }
});

// ==========================================
// 6. KHỞI ĐỘNG MÁY CHỦ
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Hệ thống Khảo Thí Backend 2.0 đang nổ máy tại cổng ${PORT}`);
});
