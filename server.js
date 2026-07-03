require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// Bật CORS để cho phép web từ Cloudflare gọi vào Railway
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cài đặt Multer: Dùng RAM làm bộ đệm để nhận file thô siêu tốc (Tối đa 15MB)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } 
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
// 2. TẠO CẤU TRÚC LƯU TRỮ (MODEL) - Gom chung vào đây cho lười
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
    teachingClasses: String
});
const User = mongoose.model('User', userSchema);

// ==========================================
// 3. CÁC API XỬ LÝ DỮ LIỆU
// ==========================================

// Đăng ký học sinh
app.post('/api/dang-ky', async (req, res) => {
    try {
        const newUser = new User({ ...req.body, role: 'student' });
        await newUser.save();
        res.status(201).json({ message: "Đăng ký thành công", data: newUser });
    } catch (error) {
        res.status(400).json({ message: "Mã định danh đã tồn tại hoặc lỗi dữ liệu" });
    }
});

// Đăng nhập
app.post('/api/dang-nhap', async (req, res) => {
    try {
        const { username, password } = req.body;
        // Mẹo nhỏ: Tự động tạo Admin nếu chưa có
        if (username === 'admin' && password === 'admin') {
            let adminUser = await User.findOne({ username: 'admin' });
            if (!adminUser) {
                adminUser = new User({ fullname: 'Quản trị viên', username: 'admin', password: 'admin', role: 'admin' });
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

// Admin: Lấy toàn bộ người dùng
app.get('/api/admin/tat-ca-users', async (req, res) => {
    try {
        const users = await User.find({});
        res.status(200).json({ data: users });
    } catch (error) {
        res.status(500).json({ message: "Lỗi truy xuất dữ liệu" });
    }
});

// Admin: Xóa user
app.post('/api/admin/xoa-user', async (req, res) => {
    try {
        await User.findByIdAndDelete(req.body.userId);
        res.status(200).json({ message: "Đã xóa thành công" });
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi xóa" });
    }
});

// Admin: Tạo Giáo viên
app.post('/api/tao-giao-vien', async (req, res) => {
    try {
        const newTeacher = new User({ ...req.body, role: 'teacher' });
        await newTeacher.save();
        res.status(201).json({ message: "Tạo giáo viên thành công", data: newTeacher });
    } catch (error) {
        res.status(400).json({ message: "Trùng User định danh hoặc thiếu thông tin" });
    }
});

// ==========================================
// 4. BỘ NÃO AI (NHẬN FORM-DATA VÀ XUẤT ĐỀ THI)
// ==========================================
app.post('/api/tao-de-thi', upload.single('file'), async (req, res) => {
    try {
        const isTN = req.body.isTN === 'true'; 
        const documentText = req.body.documentText;
        
        let fileBase64 = null;
        let fileMimeType = null;

        // Bắt file thô từ web và dịch sang ngôn ngữ của AI
        if (req.file) {
            fileBase64 = req.file.buffer.toString('base64');
            fileMimeType = req.file.mimetype;
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 

        const prompt = `Bạn là chuyên gia giáo dục xuất sắc. Hãy đọc tài liệu đính kèm hoặc nội dung sau đây và tạo một bộ câu hỏi trắc nghiệm (gồm 5 câu). 
        Cấu trúc Tốt nghiệp THPT 2025: ${isTN ? 'CÓ (Ưu tiên format câu hỏi nhiều lựa chọn và đúng/sai)' : 'KHÔNG'}.
        
        Yêu cầu BẮT BUỘC trả về ĐÚNG định dạng MẢNG JSON, KHÔNG THÊM BẤT KỲ VĂN BẢN NÀO KHÁC BÊN NGOÀI:
        [
            {
                "type": "nhiều lựa chọn",
                "questionText": "Nội dung câu hỏi?",
                "options": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
                "correctAnswer": "A"
            }
        ]
        
        Nội dung văn bản (nếu có): ${documentText || 'Hãy dùng file đính kèm.'}`;

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
        const examData = JSON.parse(responseText);

        res.status(200).json({ data: examData });

    } catch (error) {
        console.error("❌ Lỗi AI:", error);
        res.status(500).json({ message: "File quá lạ hoặc máy chủ AI đang quá tải, sếp thử lại nhé!" });
    }
});

// ==========================================
// 5. KHỞI ĐỘNG MÁY CHỦ
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Hệ thống Khảo Thí Backend đang nổ máy tại cổng ${PORT}`);
});
