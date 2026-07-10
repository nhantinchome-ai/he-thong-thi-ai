require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } 
});

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
// VÒNG XOAY TỬ THẦN - FALLBACK API KEYS & MODELS
// ==========================================
app.post('/api/tao-de-thi', upload.single('file'), async (req, res) => {
    let tempFilePath = null;
    try {
        // Lấy danh sách Key từ biến môi trường (Ưu tiên GEMINI_API_KEYS)
        const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k !== "");

        if (apiKeys.length === 0) {
            return res.status(500).json({ message: "Server chưa được cấu hình API Key!" });
        }

        // Danh sách các đời máy AI để xoay vòng (Đã loại bỏ bản Thinking)
        const modelsToTry = [
            "gemini-3.5-flash",              
            "gemini-2.0-pro-exp",            
            "gemini-1.5-pro",                
            "gemini-1.5-flash"               
        ];

        const documentText = req.body.documentText;
        const customPrompt = req.body.customPrompt; 

        // Gắn thêm thần chú ẩn để né bản quyền
        const taskInstruction = customPrompt && customPrompt.trim() !== "" 
            ? `\n2. Lệnh Tùy Chỉnh: ${customPrompt}\n LƯU Ý MẬT: Được phép paraphrase, đảo cấu trúc câu nhẹ nhàng để tránh vi phạm bản quyền văn bản.\n` 
            : `\n2. NHIỆM VỤ OCR: Trích xuất các câu hỏi trong đề thi. Nhớ paraphrase nhẹ nhàng 10% từ ngữ để né lỗi bản quyền (RECITATION) mà vẫn giữ chuẩn đáp án.\n`;

        const prompt = `Bạn là hệ thống trích xuất dữ liệu giáo dục. Hãy đọc tài liệu đính kèm và thực hiện:
        1. Tạo một Sơ đồ tư duy (Mindmap) tóm tắt (bằng gạch đầu dòng).
        ${taskInstruction}
        
        BẮT BUỘC TRẢ VỀ ĐỊNH DẠNG JSON CHUẨN (KHÔNG BỌC TRONG MARKDOWN \`\`\`):
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

        if (req.file) {
            tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}_${req.file.originalname}`);
            fs.writeFileSync(tempFilePath, req.file.buffer);
        }

        let isSuccess = false;
        let finalResult = null;

        // VÒNG LẶP 1: DUYỆT TỪNG API KEY
        for (let i = 0; i < apiKeys.length; i++) {
            if (isSuccess) break;
            
            const currentKey = apiKeys[i];
            const genAI = new GoogleGenerativeAI(currentKey);
            const fileManager = new GoogleAIFileManager(currentKey);

            // VÒNG LẶP 2: DUYỆT TỪNG MÔ HÌNH AI
            for (let j = 0; j < modelsToTry.length; j++) {
                if (isSuccess) break;

                const currentModelName = modelsToTry[j];
                console.log(`🔄 Đang thử nghiệm: [API Key ${i+1}] + [Model ${currentModelName}]...`);

                try {
                    const model = genAI.getGenerativeModel({ model: currentModelName });
                    let responseText = "";

                    if (tempFilePath) {
                        const uploadResult = await fileManager.uploadFile(tempFilePath, {
                            mimeType: req.file.mimetype,
                            displayName: req.file.originalname,
                        });

                        const result = await model.generateContent([
                            prompt,
                            { fileData: { fileUri: uploadResult.file.uri, mimeType: uploadResult.file.mimeType } }
                        ]);

                        await fileManager.deleteFile(uploadResult.file.name);
                        responseText = result.response.text();
                    } else if (req.body.fileBase64) {
                        const result = await model.generateContent([
                            prompt,
                            { inlineData: { data: req.body.fileBase64, mimeType: req.body.fileMimeType } }
                        ]);
                        responseText = result.response.text();
                    } else {
                        const result = await model.generateContent(prompt);
                        responseText = result.response.text();
                    }

                    // Làm sạch JSON
                    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                    finalResult = JSON.parse(responseText);
                    isSuccess = true;
                    console.log(`✅ THÀNH CÔNG với [Key ${i+1}] + [Model ${currentModelName}]`);

                } catch (error) {
                    console.error(`❌ Thất bại với [Key ${i+1}] + [Model ${currentModelName}]:`, error.message);
                    
                    // Nếu dính lỗi Bản quyền thì dừng lập tức, không lặp nữa vì có lặp cũng bị chặn
                    if (error.message && error.message.includes('RECITATION')) {
                        throw new Error('RECITATION_ERROR');
                    }
                    // Các lỗi khác (503, 429) sẽ tự động chạy tiếp vòng lặp để đổi Model/Key
                }
            }
        }

        // Dọn rác
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        if (isSuccess) {
            return res.status(200).json({ data: finalResult });
        } else {
            return res.status(503).json({ message: "Toàn bộ hệ thống AI đang sập, sếp vui lòng thử lại sau vài giây!" });
        }

    } catch (error) {
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        
        if (error.message === 'RECITATION_ERROR') {
            return res.status(400).json({ message: "Lỗi Bản quyền (Recitation): Hãy thêm vào lệnh tùy chỉnh chữ 'Viết lại câu hỏi'." });
        }
        res.status(500).json({ message: "Lỗi kết nối máy chủ không xác định!" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Hệ thống đang nổ máy tại cổng ${PORT}`); });
