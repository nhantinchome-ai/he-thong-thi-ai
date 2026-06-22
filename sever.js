const express = require('express');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
const bcrypt = require('bcryptjs'); // Thư viện mã hóa mật khẩu xịn sò
const { User, Attempt } = require('./models');

const app = express();
app.use(express.json());
app.use(cors());

// 1. Kết nối kho dữ liệu MongoDB
const MONGODB_URI = "mongodb+srv://nhantinchome_db_user:S6g3Zz7iPUNXNieU@cluster0.gdn7qzm.mongodb.net/he_thong_thi_ai?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI)
  .then(() => console.log("=> Da ket noi thanh cong voi Kho du lieu MongoDB!"))
  .catch(err => console.error("=> Loi ket noi:", err));

// 2. Cấu hình AI
const aiSystem = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ==========================================
// TÍNH NĂNG 1: ĐĂNG KÝ TÀI KHOẢN
// ==========================================
app.post('/api/dang-ky', async (req, res) => {
    try {
        const { fullname, username, password, role, grade, studentClass } = req.body;

        // Kiểm tra trùng lặp
        const userCu = await User.findOne({ username: username });
        if (userCu) return res.status(400).json({ message: "Tên đăng nhập đã tồn tại, vui lòng chọn tên khác!" });

        // Băm nát mật khẩu để bảo mật
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Lưu vào kho
        const newUser = new User({
            fullname,
            username,
            password: hashedPassword,
            role: role || 'student',
            grade,
            studentClass
        });

        await newUser.save();
        res.status(200).json({ message: "Đăng ký thành công!", data: { id: newUser._id, fullname: newUser.fullname } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Lỗi máy chủ khi đăng ký!" });
    }
});

// ==========================================
// TÍNH NĂNG 2: ĐĂNG NHẬP
// ==========================================
app.post('/api/dang-nhap', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Soi tài khoản
        const user = await User.findOne({ username: username });
        if (!user) return res.status(400).json({ message: "Sai tên đăng nhập!" });

        // Soi mật khẩu
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Sai mật khẩu!" });

        res.status(200).json({ 
            message: "Đăng nhập thành công!", 
            data: { id: user._id, fullname: user.fullname, grade: user.grade, studentClass: user.studentClass }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Lỗi máy chủ khi đăng nhập!" });
    }
});

// ==========================================
// TÍNH NĂNG 3: TRỘN ĐỀ THI BẰNG AI
// ==========================================
app.post('/api/tao-de-thi', async (req, res) => {
    try {
        const { studentId, weekNumber, topic } = req.body;

        const promptYeuCau = `Hãy đóng vai một giáo viên ra đề thi về chủ đề: "${topic}". 
        Yêu cầu nghiêm ngặt:
        1. Số lượng chính xác: 20 câu hỏi.
        2. Thể loại: Trộn lẫn ngẫu nhiên giữa trắc nghiệm (có 4 đáp án A, B, C, D) và tự luận (câu hỏi mở).
        3. Chống gian lận: Dữ kiện, con số hoặc cách hỏi phải độc đáo để học sinh không thể tra Google dễ dàng.
        
        BẮT BUỘC TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON SAU, TUYỆT ĐỐI KHÔNG VIẾT GÌ THÊM:
        [
          { "type": "trắc nghiệm", "questionText": "Nội dung câu hỏi?", "options": ["A", "B", "C", "D"], "correctAnswer": "A" },
          { "type": "tự luận", "questionText": "Nội dung câu hỏi mở?" }
        ]`;

        const model = aiSystem.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(promptYeuCau);
        
        const rawText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const questionsData = JSON.parse(rawText);

        const newAttempt = new Attempt({ studentId, weekNumber, generatedQuestions: questionsData });
        await newAttempt.save();

        res.status(200).json({ message: "Thành công!", data: newAttempt });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Lỗi gọi AI!" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`=> May chu 2.0 dang chay tai cong: ${PORT}`));
