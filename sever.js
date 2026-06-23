const express = require('express');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 
const { User, Attempt } = require('./models');

const app = express();
app.use(express.json());
app.use(cors());

app.get('/', (req, res) => { res.send("<h2>🚀 Máy chủ Backend V4.5 (Cấu trúc đề THPT mới) đang chạy!</h2>"); });

const MONGODB_URI = "mongodb+srv://nhantinchome_db_user:S6g3Zz7iPUNXNieU@cluster0.gdn7qzm.mongodb.net/he_thong_thi_ai?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI)
  .then(() => console.log("=> Da ket noi MongoDB V4.5!"))
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

// 2. ĐĂNG NHẬP
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

        res.status(200).json({ 
            message: "Đăng nhập thành công!", 
            data: { 
                id: user._id, fullname: user.fullname, role: user.role, 
                grade: user.grade, studentClass: user.studentClass,
                homeroomClass: user.homeroomClass || "", 
                teachingClasses: user.teachingClasses || [],
                teachingSubject: user.teachingSubject || ""
            }
        });
    } catch (error) { res.status(500).json({ message: "Lỗi máy chủ!" }); }
});

// 3. ADMIN TẠO TÀI KHOẢN GIÁO VIÊN
app.post('/api/tao-giao-vien', async (req, res) => {
    try {
        const { fullname, username, password, homeroomClass, teachingClasses, teachingSubject } = req.body;
        const userCu = await User.findOne({ username: username });
        if (userCu) return res.status(400).json({ message: "Tên đăng nhập đã tồn tại!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const arrTeaching = teachingClasses ? teachingClasses.split(',').map(c => c.trim()) : [];

        const newTeacher = new User({ 
            fullname, username, password: hashedPassword, role: 'teacher',
            homeroomClass: homeroomClass || "",
            teachingClasses: arrTeaching,
            teachingSubject: teachingSubject
        });
        await newTeacher.save();
        res.status(200).json({ message: "Tạo tài khoản Giáo viên thành công!" });
    } catch (error) { res.status(500).json({ message: "Lỗi máy chủ!" }); }
});

// 4. ADMIN XÓA TÀI KHOẢN
app.post('/api/admin/xoa-user', async (req, res) => {
    try {
        const { userId } = req.body;
        await User.findByIdAndDelete(userId);
        res.status(200).json({ message: "Đã xóa tài khoản!" });
    } catch (error) { res.status(500).json({ message: "Lỗi!" }); }
});

// 5. THỐNG KÊ SĨ SỐ LỚP
app.post('/api/thong-ke-lop', async (req, res) => {
    try {
        const count = await User.countDocuments({ role: 'student', studentClass: req.body.targetClass });
        res.status(200).json({ count: count });
    } catch (error) { res.status(500).json({ message: "Lỗi!" }); }
});

app.get('/api/admin/tat-ca-users', async (req, res) => {
    try {
        const tatCaUsers = await User.find({}, '-password');
        res.status(200).json({ data: tatCaUsers });
    } catch (error) { res.status(500).json({ message: "Lỗi!" }); }
});

// 6. LÕI AI TRỘN ĐỀ: THAY ĐỔI TOÀN BỘ SANG CẤU TRÚC ĐỀ THI TỐT NGHIỆP THPT MỚI
app.post('/api/tao-de-thi', async (req, res) => {
    try {
        const { documentText } = req.body;

        const promptYeuCau = `Bạn là chuyên gia khảo thí ra đề thi tốt nghiệp THPT của Bộ Giáo dục. 
        Hãy dựa vào nội dung bài giảng/tài liệu được cung cấp dưới đây để biên soạn đề kiểm tra trắc nghiệm. 
        TUYỆT ĐỐI KHÔNG ra đề tự luận dài.

        TÀI LIỆU HỌC TẬP:
        "${documentText}"

        YÊU CẦU ĐỀ THI PHẢI TRỘN ĐỦ 3 DẠNG SAU:
        - Dạng 1: Trắc nghiệm nhiều lựa chọn (4 đáp án A, B, C, D - Chọn 1 đáp án đúng).
        - Dạng 2: Trắc nghiệm Đúng/Sai (Mỗi câu hỏi có 4 ý a, b, c, d. Học sinh phải chọn Đúng hoặc Sai cho từng ý).
        - Dạng 3: Trắc nghiệm trả lời ngắn (Câu hỏi yêu cầu học sinh tự tính toán hoặc suy luận để điền một đáp án ngắn gọn, ví dụ số hoặc cụm từ ngắn).

        Hãy xuất ra cấu trúc dạng mảng JSON chính xác như sau để hệ thống lập trình đọc được, tuyệt đối không giải thích thêm:
        [
          { "type": "nhiều lựa chọn", "questionText": "Nội dung câu hỏi?", "options": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"], "correctAnswer": "A" },
          { "type": "đúng sai", "questionText": "Nội dung câu hỏi phân tích?", "subOptions": ["Ý a: nội dung", "Ý b: nội dung", "Ý c: nội dung", "Ý d: nội dung"] },
          { "type": "trả lời ngắn", "questionText": "Nội dung câu hỏi điền số hoặc cụm từ ngắn?" }
        ]`;

        const model = aiSystem.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(promptYeuCau);
        const rawText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        
        res.status(200).json({ message: "Thành công!", data: JSON.parse(rawText) });
    } catch (error) { 
        console.error(error);
        res.status(500).json({ message: "Lỗi gọi AI trộn đề theo format mới!" }); 
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`=> May chu V4.5 dang chay tai cong: ${PORT}`));
