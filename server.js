/**
 * SYSTEM BACKEND: NỀN TẢNG KHẢO THÍ SỐ TÍCH HỢP AI
 * Phiên bản: Chuẩn chỉnh (Final)
 * Tính năng: Chống nghẽn file 100MB, full cấu trúc Lớp/Môn, thuật toán ép chuẩn JSON.
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// ======================================================================
// 1. CẤU HÌNH CƠ SỞ HẠ TẦNG & MỞ RỘNG BĂNG THÔNG LÊN 100MB
// ======================================================================
app.use(cors());
// Mở rộng cổ chai dữ liệu để nhận file PDF, Word nặng
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!MONGODB_URI || !GEMINI_API_KEY) {
    console.error("❌ LỖI NGHIÊM TRỌNG: Thiếu biến môi trường MONGODB_URI hoặc GEMINI_API_KEY!");
}

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ ĐÃ KẾT NỐI THÀNH CÔNG ĐẾN MONGODB ATLAS!'))
    .catch(err => console.error('❌ LỖI KẾT NỐI DATABASE:', err));

// ======================================================================
// 2. KHAI BÁO CẤU TRÚC DATABASE (SCHEMA)
// ======================================================================
const userSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'teacher', 'student'], required: true },
    grade: { type: String, default: "" },
    studentClass: { type: String, default: "" },
    homeroomClass: { type: String, default: "" },
    teachingSubject: { type: String, default: "" },
    // teachingClasses là trường sống còn để Giáo viên thấy được Lớp lúc ra đề
    teachingClasses: { type: String, default: "" } 
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ======================================================================
// 3. API TÀI KHOẢN VÀ QUẢN TRỊ
// ======================================================================

// [API] Đăng ký học sinh
app.post('/api/dang-ky', async (req, res) => {
    try {
        const { fullname, username, password, grade, studentClass } = req.body;
        const checkUser = await User.findOne({ username: username.trim() });
        if (checkUser) return res.status(400).json({ message: "Mã định danh đã tồn tại!" });

        const newUser = new User({
            fullname: fullname.trim(),
            username: username.trim(),
            password: password.trim(),
            role: 'student',
            grade,
            studentClass
        });
        await newUser.save();
        res.status(200).json({ message: "Đăng ký thành công!" });
    } catch (error) {
        res.status(500).json({ message: "Lỗi hệ thống khi tạo tài khoản!" });
    }
});

// [API] Cấp tài khoản giáo viên (Từ Admin)
app.post('/api/tao-giao-vien', async (req, res) => {
    try {
        const { fullname, username, password, homeroomClass, teachingSubject, teachingClasses } = req.body;
        const checkUser = await User.findOne({ username: username.trim() });
        if (checkUser) return res.status(400).json({ message: "Mã cán bộ đã tồn tại!" });

        const newTeacher = new User({
            fullname: fullname.trim(),
            username: username.trim(),
            password: password.trim(),
            role: 'teacher',
            homeroomClass,
            teachingSubject,
            teachingClasses 
        });
        await newTeacher.save();
        res.status(200).json({ message: "Cấp quyền thành công!" });
    } catch (error) {
        res.status(500).json({ message: "Lỗi cơ sở dữ liệu khi tạo giáo viên!" });
    }
});

// [API] Đăng nhập hệ thống
app.post('/api/dang-nhap', async (req, res) => {
    try {
        const { username, password } = req.body;
        const cleanUsr = username.trim();
        const cleanPwd = password.trim();

        // Tài khoản Admin cứng để bypass Database
        if (cleanUsr === 'admin' && cleanPwd === 'admin123') {
            return res.status(200).json({
                data: { username: 'admin', fullname: 'Super Administrator', role: 'admin' }
            });
        }

        const user = await User.findOne({ username: cleanUsr, password: cleanPwd });
        if (!user) return res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu!" });

        res.status(200).json({ data: user });
    } catch (error) {
        res.status(500).json({ message: "Lỗi trong quá trình đăng nhập!" });
    }
});

// [API] Lấy danh sách toàn bộ Users cho sơ đồ tổ chức Admin
app.get('/api/admin/tat-ca-users', async (req, res) => {
    try {
        const users = await User.find({}, '-password -__v');
        res.status(200).json({ data: users });
    } catch (error) {
        res.status(500).json({ message: "Lỗi đồng bộ danh sách!" });
    }
});

// [API] Xóa User
app.post('/api/admin/xoa-user', async (req, res) => {
    try {
        const { userId } = req.body;
        await User.findByIdAndDelete(userId);
        res.status(200).json({ message: "Đã xóa tài khoản!" });
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi thực hiện lệnh xóa!" });
    }
});

// ======================================================================
// 4. LÕI AI ENGINE: ĐỌC DỮ LIỆU & TẠO ĐỀ THI BẰNG GEMINI
// ======================================================================
app.post('/api/tao-de-thi', async (req, res) => {
    try {
        const { documentText, fileBase64, fileMimeType, isTN } = req.body;
        // Gọi thẳng model flash để tối ưu tốc độ phản hồi
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Phân nhánh logic dựa trên việc người dùng có tick chọn cấu trúc Tốt Nghiệp 2025 hay không
        let formatInstruction = isTN 
            ? `Bao gồm 3 định dạng sau:
               1. "nhiều lựa chọn": questionText (câu hỏi), options (mảng đúng 4 đáp án), correctAnswer (ký tự A, B, C, D).
               2. "đúng sai": questionText (câu cốt lõi), subOptions (mảng đúng 4 ý phụ), correctAnswers (mảng đúng 4 ký tự 'D' hoặc 'S').
               3. "trả lời ngắn": questionText (câu hỏi), correctAnswer (đáp án rất ngắn).
               Hãy tạo 6 câu hỏi trộn lẫn 3 định dạng trên.`
            : `Chỉ bao gồm DUY NHẤT 1 định dạng:
               "nhiều lựa chọn": questionText (câu hỏi), options (mảng đúng 4 đáp án), correctAnswer (ký tự A, B, C, D).
               Hãy tạo đúng 5 câu hỏi trắc nghiệm. Không tạo Đúng/Sai hay tự luận.`;

        const prompt = `Đọc nội dung tài liệu và tạo đề kiểm tra trả về định dạng mảng JSON (Array of Objects).
YÊU CẦU TỐI THƯỢNG:
- Trả về DUY NHẤT chuỗi mảng JSON hợp lệ để máy tính có thể parse trực tiếp.
- Tuyệt đối không dùng markdown như \`\`\`json để bọc khối mã. Không in ra bất kỳ chữ nào ngoài mảng JSON.
- Cấu trúc bắt buộc: ${formatInstruction}`;

        let promptParts = [prompt];
        
        // Nhồi file Base64 (nếu có)
        if (fileBase64 && fileMimeType) {
            promptParts.push({ inlineData: { data: fileBase64, mimeType: fileMimeType } });
        }
        
        // Nhồi văn bản đã trích xuất từ Word/TXT (nếu có)
        if (documentText && documentText.trim().length > 0) {
            promptParts.push(`\n--- NỘI DUNG TÀI LIỆU ---\n${documentText}`);
        }

        // Kích hoạt AI
        const result = await model.generateContent(promptParts);
        let rawText = result.response.text().trim();

        // Thuật toán "tẩy rửa": Xóa rác markdown (```json và ```) nếu AI lỡ tay sinh ra
        if (rawText.startsWith('```json')) {
            rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        } else if (rawText.startsWith('```')) {
            rawText = rawText.replace(/```/g, '').trim();
        }

        // Bọc lỗi parse JSON để tránh sập app nếu AI trả về chuỗi hỏng
        const questionsArray = JSON.parse(rawText);
        res.status(200).json({ data: questionsArray });
        
    } catch (error) {
        console.error("Lỗi tạo đề thi bằng AI:", error);
        res.status(500).json({ message: "Lỗi AI xử lý hoặc file bị sai cấu trúc. Vui lòng thử lại!" });
    }
});

// Khởi chạy server tại cổng mặc định của Render (10000)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 SERVER ĐÃ SẴN SÀNG CHẠY TẠI CỔNG: ${PORT}`);
});
