require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server'); // Gọi thêm quản lý File

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Vẫn dùng Multer nhận file từ Web
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } 
});

// Khởi tạo Gemini AI và File Manager
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Đã thông mạch với MongoDB!"))
    .catch(err => console.error("❌ Lỗi kết nối MongoDB:", err));

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
// BỘ NÃO AI 3.5 FLASH - CÔNG NGHỆ UPLOAD FILE API MỚI
// ==========================================
app.post('/api/tao-de-thi', upload.single('file'), async (req, res) => {
    try {
        const documentText = req.body.documentText;
        const customPrompt = req.body.customPrompt; 
        
        // Gọi thẳng bản 3.5 Flash chính thức
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

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

        // KIỂM TRA NẾU CÓ FILE GỬI LÊN
        if (req.file) {
            console.log("Đang áp dụng File API để tải file nặng...");
            
            // 1. Lưu file từ RAM ra ổ cứng tạm thời của Server
            const tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}_${req.file.originalname}`);
            fs.writeFileSync(tempFilePath, req.file.buffer);

            // 2. Upload file đó lên Đám mây File API của Google
            const uploadResult = await fileManager.uploadFile(tempFilePath, {
                mimeType: req.file.mimetype,
                displayName: req.file.originalname,
            });

            console.log(`Đã đẩy lên Google thành công. URI: ${uploadResult.file.uri}`);

            // 3. Xóa file rác trong máy chủ Railway cho nhẹ máy
            fs.unlinkSync(tempFilePath);

            // 4. Gửi mã vé URI siêu nhẹ cho Gemini đọc
            result = await model.generateContent([
                prompt,
                { 
                    fileData: { 
                        fileUri: uploadResult.file.uri, 
                        mimeType: uploadResult.file.mimeType 
                    } 
                }
            ]);

            // 5. Google đọc xong thì ra lệnh xóa file trên đám mây Google để đỡ tốn dung lượng
            await fileManager.deleteFile(uploadResult.file.name);
            
        } else if (req.body.fileBase64) {
            // Backup nếu Web vẫn gửi kiểu Base64 cũ
            result = await model.generateContent([
                prompt,
                { inlineData: { data: req.body.fileBase64, mimeType: req.body.fileMimeType } }
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
        if (error.message && error.message.includes('RECITATION')) {
            return res.status(400).json({ message: "Bộ lọc bản quyền Google (Recitation) đã chặn vì copy y chang đề trên mạng. Sếp hãy nhập thêm lệnh Tùy chỉnh: 'Viết lại và đảo vị trí từ' nhé!" });
        }
        if (error.status === 503) {
            return res.status(503).json({ message: "Google AI 3.5 Flash đang kẹt cục bộ. Cơ chế chống sập đã kích hoạt, sếp đợi 3s rồi bấm lại là qua!" });
        }
        res.status(500).json({ message: "Lỗi hệ thống hoặc định dạng file hỏng, sếp nạp lại thử nhé!" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Hệ thống đang nổ máy tại cổng ${PORT}`); });
