const express = require('express');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 
const { User, Attempt } = require('./models');

const app = express();
app.use(express.json());
app.use(cors());

// Giao diện chống lỗi Cannot GET /
app.get('/', (req, res) => { res.send("<h2>🚀 Máy chủ Backend V3 (vnEdu Clone) đang hoạt động 100% công suất!</h2>"); });

const MONGODB_URI = "mongodb+srv://nhantinchome_db_user:S6g3Zz7iPUNXNieU@cluster0.gdn7qzm.mongodb.net/he_thong_thi_ai?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI)
  .then(() => console.log("=> Da ket noi MongoDB V3!"))
  .catch(err => console.error("=> Loi ket noi:", err));

const aiSystem = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 1. ĐĂNG KÝ HỌC SINH
app.post('/api/dang-ky', async (req, res) => {
    try {
        const { fullname, username, password, grade, studentClass } = req.body;
        const userCu = await User.findOne({ username: username });
        if (userCu) return res.status(400).json({ message: "Tên đăng nhập đã tồn tại!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ fullname, username, password: hashedPassword, role: 'student', grade, studentClass });
        await newUser.save();
        res.status(200).json({ message: "Đăng ký thành công!", data: { id: newUser._id, fullname: newUser.fullname, role: 'student' } });
    } catch (error) { res.status(500).json({ message: "Lỗi máy chủ!" }); }
});

// 2. ĐĂNG NHẬP (Lấy luôn quyền GVCN và GVBM)
app.post('/api/dang-nhap', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (username === "admin_phuc" && password === "phucdeptrai123") {
            return res.status(200).json({ message: "Chào mừng Admin!", data: { id: "ADMIN_ROOT", fullname: "Admin (Xuân Phúc)", role: "admin" } });
        }

        const user = await User.findOne({ username: username });
        if (!user) return res.status(400).json({ message: "Sai tên đăng nhập!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Sai mật khẩu!" });

        // Trả về kèm theo Lớp chủ nhiệm và Các lớp giảng dạy (nếu là GV)
        res.status(200).json({ 
            message: "Đăng nhập thành công!", 
            data: { 
                id: user._id, fullname: user.fullname, role: user.role, 
                grade: user.grade, studentClass: user.studentClass,
                homeroomClass: user.homeroomClass || "", // Mới
                teachingClasses: user.teachingClasses || [] // Mới
            }
        });
    } catch (error) { res.status(500).json({ message: "Lỗi máy chủ!" }); }
});

// 3. ADMIN TẠO TÀI KHOẢN GIÁO VIÊN (Nâng cấp phân quyền lớp)
app.post('/api/tao-giao-vien', async (req, res) => {
    try {
        const { fullname, username, password, homeroomClass, teachingClasses } = req.body;
        const userCu = await User.findOne({ username: username });
        if (userCu) return res.status(400).json({ message: "Tên đăng nhập đã tồn tại!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Chuyển chuỗi "10A,10B" thành mảng ['10A', '10B']
        const arrTeaching = teachingClasses ? teachingClasses.split(',').map(c => c.trim()) : [];

        const newTeacher = new User({ 
            fullname, username, password: hashedPassword, role: 'teacher',
            homeroomClass: homeroomClass || "",
            teachingClasses: arrTeaching
        });
        await newTeacher.save();
        res.status(200).json({ message: "Tạo tài khoản Giáo viên thành công!" });
    } catch (error) { res.status(500).json({ message: "Lỗi máy chủ!" }); }
});

// 4. API THỐNG KÊ (Đếm số học sinh trong 1 lớp) - TÍNH NĂNG MỚI
app.post('/api/thong-ke-lop', async (req, res) => {
    try {
        const { targetClass } = req.body;
        const count = await User.countDocuments({ role: 'student', studentClass: targetClass });
        res.status(200).json({ count: count });
    } catch (error) { res.status(500).json({ message: "Lỗi đếm số lượng!" }); }
});

// 5. TRỘN ĐỀ BẰNG AI
app.post('/api/tao-de-thi', async (req, res) => {
    try {
        const { studentId, weekNumber, topic } = req.body;
        const promptYeuCau = `Hãy đóng vai giáo viên ra đề: "${topic}". Yêu cầu: 20 câu (trắc nghiệm + tự luận). Chống gian lận. Trả về JSON: [{"type": "trắc nghiệm", "questionText": "?", "options": ["A","B","C","D"], "correctAnswer": "A"}, {"type": "tự luận", "questionText": "?"}]`;

        const model = aiSystem.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(promptYeuCau);
        const rawText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        
        res.status(200).json({ message: "Thành công!", data: { generatedQuestions: JSON.parse(rawText) } });
    } catch (error) { res.status(500).json({ message: "Lỗi gọi AI!" }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`=> May chu V3 dang chay tai cong: ${PORT}`));
