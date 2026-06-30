const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Gọi cấu trúc dữ liệu từ models.js sang
const { User, Attempt } = require('./models');

const app = express();
app.use(cors());

// ======================================================================
// NỚI LỎNG CỔ CHAI LÊN 50MB ĐỂ CHỨA VỪA FILE PDF/ẢNH SCAN
// ======================================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Tự động lấy chìa khóa từ Render
const MONGODB_URI = process.env.MONGODB_URI; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Đã cắm chốt thành công vào MongoDB Atlas!'))
    .catch(err => console.error('❌ Kết nối MongoDB thất bại:', err));

// ======================================================================
// HỆ THỐNG API QUẢN LÝ TÀI KHOẢN
// ======================================================================
app.post('/api/dang-ky', async (req, res) => {
    try {
        const { fullname, username, password, grade, studentClass } = req.body;
        const checkUser = await User.findOne({ username });
        if (checkUser) return res.status(400).json({ message: "Tài khoản đã tồn tại!" });

        const newUser = new User({ fullname, username, password, role: 'student', grade, studentClass });
        await newUser.save();
        res.status(200).json({ message: "Tạo hồ sơ học sinh thành công!" });
    } catch (error) { res.status(500).json({ message: "Lỗi máy chủ Database!" }); }
});

app.post('/api/tao-giao-vien', async (req, res) => {
    try {
        const { fullname, username, password, homeroomClass, teachingSubject, teachingClasses } = req.body;
        const checkUser = await User.findOne({ username });
        if (checkUser) return res.status(400).json({ message: "Mã định danh đã có người sử dụng!" });

        const newTeacher = new User({ 
            fullname, username, password, role: 'teacher', 
            homeroomClass, teachingSubject, teachingClasses 
        });
        await newTeacher.save();
        res.status(200).json({ message: "Cấp phát tài khoản Giáo viên thành công!" });
    } catch (error) { res.status(500).json({ message: "Lỗi lưu dữ liệu!" }); }
});

app.post('/api/dang-nhap', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (username === 'admin' && password === 'admin123') {
            return res.status(200).json({ data: { username: 'admin', fullname: 'Super Admin', role: 'admin' } });
        }
        const user = await User.findOne({ username, password });
        if (!user) return res.status(401).json({ message: "Sai mã định danh hoặc mật khẩu!" });
        res.status(200).json({ data: user });
    } catch (error) { res.status(500).json({ message: "Lỗi xử lý đăng nhập!" }); }
});

app.get('/api/admin/tat-ca-users', async (req, res) => {
    try {
        const users = await User.find({}, '-__v'); 
        res.status(200).json({ data: users });
    } catch (error) { res.status(500).json({ message: "Không thể lấy dữ liệu từ kho!" }); }
});

app.post('/api/admin/xoa-user', async (req, res) => {
    try {
        await User.findByIdAndDelete(req.body.userId);
        res.status(200).json({ message: "Đã xóa vĩnh viễn!" });
    } catch (error) { res.status(500).json({ message: "Lỗi thao tác xóa!" }); }
});

// ======================================================================
// LÕI AI GEMINI (NÂNG CẤP ĐỌC TRỰC TIẾP FILE ẢNH SCAN PDF BASE64)
// ======================================================================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

app.post('/api/tao-de-thi', async (req, res) => {
    try {
        const { documentText, fileBase64, fileMimeType, isTN } = req.body; 
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Tùy biến cấu trúc đề theo nút tích của sếp
        let formatInstruction = isTN 
            ? `bao gồm 3 dạng câu hỏi sau:
               1. "nhiều lựa chọn": questionText, mảng options (4 đáp án), correctAnswer (A, B, C hoặc D).
               2. "đúng sai": questionText, mảng subOptions (4 ý a,b,c,d), mảng correctAnswers (chứa 4 chữ "D" hoặc "S").
               3. "trả lời ngắn": questionText, correctAnswer (1 từ hoặc 1 số ngắn gọn).
               Tạo tổng cộng 6 câu hỏi trộn lẫn các dạng trên.`
            : `chỉ bao gồm DUY NHẤT 1 dạng câu hỏi:
               1. "nhiều lựa chọn": questionText, mảng options (4 đáp án), correctAnswer (A, B, C hoặc D).
               Tạo tổng cộng 5 câu hỏi trắc nghiệm. Tuyệt đối KHÔNG tạo dạng đúng/sai hay trả lời ngắn.`;

        const prompt = `Dựa vào nội dung học liệu được cung cấp, hãy đóng vai là một giáo viên chuyên môn và tạo ra một ma trận bài kiểm tra.
Yêu cầu xuất ra MỘT MẢNG JSON HỢP LỆ (Tuyệt đối không bọc trong markdown \`\`\`json), ${formatInstruction}
CHỈ TRẢ VỀ CHUẨN ĐỊNH DẠNG JSON, KHÔNG CÓ BẤT KỲ VĂN BẢN NÀO KHÁC.`;

        // Chuẩn bị gói dữ liệu gửi cho AI (Gồm Lệnh Prompt + Chữ text + File ảnh PDF nếu có)
        let promptParts = [prompt];

        if (fileBase64 && fileMimeType) {
            promptParts.push({ inlineData: { data: fileBase64, mimeType: fileMimeType } });
        }
        
        if (documentText) {
            promptParts.push(`\nNội dung học liệu dạng văn bản bổ sung: "${documentText}"`);
        }

        const result = await model.generateContent(promptParts);
        let rawText = result.response.text().trim();
        
        // Dọn dẹp rác markdown nếu AI trả về dư thừa
        if (rawText.startsWith('```json')) rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        if (rawText.startsWith('```')) rawText = rawText.replace(/```/g, '').trim();

        const questionsArray = JSON.parse(rawText);
        res.status(200).json({ data: questionsArray });
    } catch (error) {
        console.error("Lỗi AI Core:", error);
        res.status(500).json({ message: "Lỗi phân tích cú pháp từ Cloud AI!" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Máy chủ Backend đang chạy mượt mà ở cổng ${PORT}`);
});
