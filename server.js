const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const { User, Attempt } = require('./models');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Nới lỏng cổ chai để chứa vừa file PDF gửi lên

const MONGODB_URI = process.env.MONGODB_URI; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

mongoose.connect(MONGODB_URI).then(() => console.log('✅ Đã cắm chốt MongoDB!')).catch(err => console.error('❌ Lỗi DB:', err));

// CÁC API ĐỊNH DANH (GIỮ NGUYÊN)
app.post('/api/dang-ky', async (req, res) => {
    try {
        const { fullname, username, password, grade, studentClass } = req.body;
        const checkUser = await User.findOne({ username });
        if (checkUser) return res.status(400).json({ message: "Tài khoản đã tồn tại!" });
        const newUser = new User({ fullname, username, password, role: 'student', grade, studentClass });
        await newUser.save();
        res.status(200).json({ message: "Tạo hồ sơ thành công!" });
    } catch (error) { res.status(500).json({ message: "Lỗi DB!" }); }
});

app.post('/api/tao-giao-vien', async (req, res) => {
    try {
        const { fullname, username, password, homeroomClass, teachingSubject, teachingClasses } = req.body;
        const checkUser = await User.findOne({ username });
        if (checkUser) return res.status(400).json({ message: "Trùng mã định danh!" });
        const newTeacher = new User({ fullname, username, password, role: 'teacher', homeroomClass, teachingSubject, teachingClasses });
        await newTeacher.save();
        res.status(200).json({ message: "Thành công!" });
    } catch (error) { res.status(500).json({ message: "Lỗi DB!" }); }
});

app.post('/api/dang-nhap', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (username === 'admin' && password === 'admin123') return res.status(200).json({ data: { username: 'admin', fullname: 'Super Admin', role: 'admin' } });
        const user = await User.findOne({ username, password });
        if (!user) return res.status(401).json({ message: "Sai định danh hoặc mật khẩu!" });
        res.status(200).json({ data: user });
    } catch (error) { res.status(500).json({ message: "Lỗi Server!" }); }
});

app.get('/api/admin/tat-ca-users', async (req, res) => {
    try { const users = await User.find({}, '-__v'); res.status(200).json({ data: users }); } 
    catch (error) { res.status(500).json({ message: "Lỗi DB!" }); }
});

app.post('/api/admin/xoa-user', async (req, res) => {
    try { await User.findByIdAndDelete(req.body.userId); res.status(200).json({ message: "Đã xóa!" }); } 
    catch (error) { res.status(500).json({ message: "Lỗi xóa!" }); }
});

// ======================================================================
// LÕI AI GEMINI (NÂNG CẤP ĐỌC TRỰC TIẾP FILE ẢNH SCAN PDF)
// ======================================================================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

app.post('/api/tao-de-thi', async (req, res) => {
    try {
        const { documentText, fileBase64, fileMimeType, isTN } = req.body; 
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        let formatInstruction = isTN 
            ? `bao gồm 3 dạng câu hỏi:
               1. "nhiều lựa chọn": questionText, mảng options (4 đáp án), correctAnswer (A, B, C hoặc D).
               2. "đúng sai": questionText, mảng subOptions (4 ý a,b,c,d), mảng correctAnswers (chứa 4 chữ "D" hoặc "S").
               3. "trả lời ngắn": questionText, correctAnswer (1 từ/số ngắn).
               Tạo 6 câu hỏi trộn lẫn.`
            : `chỉ bao gồm DUY NHẤT 1 dạng:
               1. "nhiều lựa chọn": questionText, mảng options (4 đáp án), correctAnswer (A, B, C hoặc D).
               Tạo 5 câu trắc nghiệm. Không tạo dạng đúng/sai hay trả lời ngắn.`;

        const prompt = `Đóng vai giáo viên chuyên môn tạo ma trận kiểm tra.
Yêu cầu xuất MỘT MẢNG JSON HỢP LỆ (Không bọc trong markdown), ${formatInstruction} CHỈ TRẢ VỀ JSON.`;

        let promptParts = [prompt];

        // Nếu có nạp thẳng file PDF (Ảnh scan hoặc text đều nhai hết)
        if (fileBase64 && fileMimeType) {
            promptParts.push({ inlineData: { data: fileBase64, mimeType: fileMimeType } });
        }
        // Nếu có text bóc tách từ Word hoặc gõ tay
        if (documentText) {
            promptParts.push(`Học liệu: "${documentText}"`);
        }

        const result = await model.generateContent(promptParts);
        let rawText = result.response.text().trim();
        
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
app.listen(PORT, () => { console.log(`🚀 Máy chủ Backend đang chạy mượt mà ở cổng ${PORT}`); });
