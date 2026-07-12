require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// Cấu hình Middleware
app.use(cors());
// Tăng dung lượng JSON lên 50MB để chứa vừa Ảnh Base64 học sinh gửi lên
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// =====================================================================
// 1. KẾT NỐI MONGODB TỰ ĐỘNG
// =====================================================================
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Đã kết nối thành công tới Database MongoDB!'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// =====================================================================
// 2. KHAI BÁO CẤU TRÚC KHO CHỨA (SCHEMAS)
// =====================================================================

// Kho chứa Người Dùng
const UserSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'student' }, // admin, teacher, student
    grade: String,
    studentClass: String,
    homeroomClass: String,
    teachingSubject: String,
    teachingClasses: String,
    createdAt: { type: Number, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// Kho chứa Đề Thi
const ExamSchema = new mongoose.Schema({
    id: String, 
    targetClass: String, 
    category: String, 
    subject: String,
    topic: String, 
    duration: Number, 
    mindmap: String, 
    questions: Array,
    teacherName: String, 
    createdAt: Number
});
const Exam = mongoose.model('Exam', ExamSchema);

// Kho chứa Điểm Số
const ScoreSchema = new mongoose.Schema({
    examId: String, 
    topic: String, 
    subject: String, 
    teacherName: String,
    studentUsername: String, 
    studentName: String, 
    studentClass: String,
    score: String, 
    time: String, 
    attempt: Number, 
    details: Array
});
const Score = mongoose.model('Score', ScoreSchema);


// =====================================================================
// 3. CÁC API QUẢN LÝ TÀI KHOẢN (AUTH & USERS)
// =====================================================================

app.post('/api/dang-nhap', async (req, res) => {
    try {
        const { username, password } = req.body;
        // Bắt tài khoản Admin tối cao ẩn (Hardcode)
        if (username === 'admin' && password === 'admin') {
            return res.json({ success: true, data: { username: 'admin', fullname: 'Quản Trị Viên Hệ Thống', role: 'admin' }});
        }

        const user = await User.findOne({ username, password });
        if (!user) return res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu!' });
        
        res.json({ success: true, data: user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/dang-ky', async (req, res) => {
    try {
        const exists = await User.findOne({ username: req.body.username });
        if (exists) return res.status(400).json({ success: false, message: 'Tên đăng nhập đã tồn tại!' });

        const newUser = new User(req.body);
        await newUser.save();
        res.json({ success: true, message: 'Đăng ký thành công!' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/tat-ca-users', async (req, res) => {
    try {
        const users = await User.find();
        // Nhét thêm ông Admin vào danh sách trả về
        const adminUser = { _id: 'admin_id', username: 'admin', fullname: 'Quản Trị Viên Hệ Thống', role: 'admin', createdAt: Date.now() };
        res.json({ success: true, data: [adminUser, ...users] });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/tao-giao-vien', async (req, res) => {
    try {
        const exists = await User.findOne({ username: req.body.username });
        if (exists) return res.status(400).json({ success: false, message: 'Tài khoản GV đã tồn tại!' });

        const newTeacher = new User({ ...req.body, role: 'teacher' });
        await newTeacher.save();
        res.json({ success: true, message: 'Tạo tài khoản GV thành công!' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/xoa-user', async (req, res) => {
    try {
        await User.findByIdAndDelete(req.body.userId);
        res.json({ success: true, message: 'Xóa user thành công!' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// =====================================================================
// 4. CÁC API QUẢN LÝ ĐỀ THI & ĐIỂM SỐ
// =====================================================================

app.post('/api/exams', async (req, res) => {
    try {
        const newExam = new Exam(req.body);
        await newExam.save();
        res.json({ success: true, message: 'Lưu đề lên mây thành công!' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/exams', async (req, res) => {
    try {
        const exams = await Exam.find();
        res.json({ success: true, data: exams });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/exams/delete', async (req, res) => {
    try {
        await Exam.deleteOne({ id: req.body.id });
        res.json({ success: true, message: 'Đã xóa đề khỏi Database' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/scores', async (req, res) => {
    try {
        const newScore = new Score(req.body);
        await newScore.save();
        res.json({ success: true, message: 'Lưu điểm lên mây thành công!' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/scores', async (req, res) => {
    try {
        const scores = await Score.find();
        res.json({ success: true, data: scores });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/scores/delete', async (req, res) => {
    try {
        await Score.findByIdAndDelete(req.body._id);
        res.json({ success: true, message: 'Đã xóa điểm khỏi Database' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// =====================================================================
// 5. TRÁI TIM HỆ THỐNG: API KẾT NỐI GOOGLE GEMINI TẠO ĐỀ THI
// =====================================================================

// Khởi tạo Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/tao-de-thi', async (req, res) => {
    try {
        const { documentText, fileBase64, fileMimeType, customPrompt, teachingSubject } = req.body;

        if (!documentText && !fileBase64) {
            return res.status(400).json({ success: false, message: "Không nhận được dữ liệu văn bản hoặc hình ảnh!" });
        }

        // Chọn model (Dùng 1.5-flash cho nhẹ, nhanh và hỗ trợ ảnh tốt nhất)
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            // Ép AI phải trả về chuẩn định dạng JSON, cấm nói linh tinh
            generationConfig: { responseMimeType: "application/json" }
        });

        // Xây dựng mảng dữ liệu đẩy lên AI
        const promptParts = [];

        // Câu lệnh cốt lõi bọc thép
        const coreInstruction = `
        Bạn là hệ thống Khảo thí Giáo dục xuất sắc nhất.
        Dựa vào dữ liệu được cung cấp (Văn bản hoặc Hình ảnh), hãy tạo ra bài kiểm tra trắc nghiệm theo yêu cầu sau:
        - Môn học hiện tại: ${teachingSubject || 'Tổng hợp'}.
        - Chỉ thị thêm từ Giáo viên: ${customPrompt || 'Sáng tác đề thi chuẩn, nội dung chính xác.'}
        
        TRẢ VỀ DUY NHẤT 1 FILE JSON THEO ĐÚNG CẤU TRÚC SAU (KHÔNG DƯ DẤU PHẨY, KHÔNG THIẾU NGOẶC):
        {
            "mindmap": "# Tiêu đề\\n- Ý chính 1\\n  - Ý phụ 1",
            "teacher_image_notes": [
                { "cau_hien_tai": "Câu 1", "cau_goc": "Câu 2 trong ảnh", "mo_ta_hinh_anh_can_chen": "Sơ đồ mạch điện..." }
            ],
            "exam": [
                {
                    "type": "nhiều lựa chọn",
                    "questionText": "Nội dung câu hỏi trắc nghiệm?",
                    "options": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
                    "correctAnswer": "A"
                },
                {
                    "type": "đúng sai",
                    "questionText": "Nội dung câu dẫn mệnh đề đúng/sai?",
                    "subOptions": ["Mệnh đề 1", "Mệnh đề 2", "Mệnh đề 3", "Mệnh đề 4"],
                    "correctAnswers": ["D", "S", "D", "S"]
                }
            ]
        }
        `;

        promptParts.push(coreInstruction);

        if (documentText) {
            promptParts.push(`\n\n--- VĂN BẢN TRÍCH XUẤT TỪ FILE TÀI LIỆU ---\n${documentText}`);
        }

        if (fileBase64 && fileMimeType) {
            promptParts.push({
                inlineData: {
                    data: fileBase64,
                    mimeType: fileMimeType
                }
            });
        }

        // Kích hoạt AI
        const result = await model.generateContent(promptParts);
        const response = await result.response;
        const textResult = response.text();

        // Chuyển đổi kết quả JSON text sang Object thật
        const finalData = JSON.parse(textResult);

        res.json({ success: true, data: finalData });

    } catch (error) {
        console.error("Lỗi AI Gemini:", error);
        res.status(500).json({ success: false, message: "AI bị quá tải hoặc lỗi định dạng: " + error.message });
    }
});


// =====================================================================
// 6. KHỞI ĐỘNG SERVER
// =====================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Máy chủ Khảo Thí AI đang bốc đầu tại cổng ${PORT}`);
});
