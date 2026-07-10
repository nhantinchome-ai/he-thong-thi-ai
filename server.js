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
// HÀM NHẬN DIỆN MÔN HỌC & TẠO THẦN CHÚ LÁCH BẢN QUYỀN
// ==========================================
function getSmartPrompt(subject, customPrompt) {
    let base = customPrompt && customPrompt.trim() !== "" ? `\nLệnh Tùy Chỉnh từ GV: ${customPrompt}\n` : "";
    const subj = (subject || "").toLowerCase();

    if (subj.includes('toán') || subj.includes('lý') || subj.includes('vật lí') || subj.includes('hóa') || subj.includes('tin')) {
        return base + `[CHỈ THỊ TỐI MẬT - KHỐI TỰ NHIÊN]: Bắt buộc viết lại (paraphrase) phần lời văn của câu hỏi bằng từ đồng nghĩa. TUYỆT ĐỐI GIỮ NGUYÊN 100% các con số, biến số, công thức, ký hiệu toán học/hóa học và đáp án.`;
    } else if (subj.includes('văn') || subj.includes('sử') || subj.includes('địa') || subj.includes('gdcd') || subj.includes('kinh tế')) {
        return base + `[CHỈ THỊ TỐI MẬT - KHỐI XÃ HỘI]: Bắt buộc diễn đạt lại toàn bộ câu hỏi bằng cách đảo cấu trúc câu, thay thế ít nhất 30% từ vựng bằng từ đồng nghĩa để tránh bản quyền. TUYỆT ĐỐI GIỮ NGUYÊN các mốc thời gian, địa danh, tên nhân vật, sự kiện và đáp án đúng.`;
    } else if (subj.includes('anh') || subj.includes('ngoại ngữ')) {
        return base + `[CHỈ THỊ TỐI MẬT - KHỐI NGOẠI NGỮ]: Chỉ được phép viết lại (paraphrase) phần "yêu cầu bằng tiếng Việt" của đề bài. TUYỆT ĐỐI GIỮ NGUYÊN 100% đoạn văn đọc hiểu (Reading), câu hỏi ngữ pháp tiếng Anh và các từ vựng trong đáp án. Không được dịch tiếng Anh sang tiếng Việt.`;
    } else {
        return base + `[CHỈ THỊ TỐI MẬT - CHUNG]: Bắt buộc diễn đạt lại câu hỏi bằng từ đồng nghĩa và đảo cấu trúc câu để không trùng lặp văn bản gốc. Giữ nguyên 100% dữ liệu cốt lõi và đáp án.`;
    }
}

// ==========================================
// BỘ NÃO AI OCR - CƠ CHẾ AUTO LÁCH BẢN QUYỀN
// ==========================================
app.post('/api/tao-de-thi', upload.single('file'), async (req, res) => {
    let tempFilePath = null;
    try {
        const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k !== "");
        if (apiKeys.length === 0) return res.status(500).json({ message: "Server chưa cấu hình API Key!" });

        const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];

        // Hứng môn học từ Frontend gửi lên (Nếu có)
        const teachingSubject = req.body.teachingSubject || "Mặc định"; 
        const documentText = req.body.documentText;
        const customPrompt = req.body.customPrompt; 

        if (req.file) {
            tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}_${req.file.originalname}`);
            fs.writeFileSync(tempFilePath, req.file.buffer);
        }

        let isSuccess = false;
        let finalResult = null;
        let isRecitationMode = false; // Cờ theo dõi xem đã bị gõ bản quyền chưa

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // VÒNG LẶP KEY
        for (let i = 0; i < apiKeys.length; i++) {
            if (isSuccess) break;
            const currentKey = apiKeys[i];
            const genAI = new GoogleGenerativeAI(currentKey);
            const fileManager = new GoogleAIFileManager(currentKey);

            // VÒNG LẶP MODEL
            for (let j = 0; j < modelsToTry.length; j++) {
                if (isSuccess) break;
                const currentModelName = modelsToTry[j];
                
                let modeText = isRecitationMode ? "⚡ CHẾ ĐỘ XÀO BÀI" : "🔰 CHẾ ĐỘ NGUYÊN BẢN";
                console.log(`🔄 Đang chạy: [Model ${currentModelName}] - ${modeText}...`);

                // 1. CHIA ĐƯỜNG CÂU LỆNH DỰA VÀO CỜ BẢN QUYỀN
                let currentInstruction = "";
                if (!isRecitationMode) {
                    // LẦN 1: Bắt buộc giữ nguyên 100% nguyên gốc
                    currentInstruction = `\n2. NHIỆM VỤ OCR CHUẨN: BẮT BUỘC trích xuất chính xác 100% văn bản gốc. Tuyệt đối không được thêm bớt, tự ý tóm tắt hay sửa đổi bất kỳ từ ngữ nào của đề thi.\n`;
                    if (customPrompt) currentInstruction += `Lệnh tùy chỉnh: ${customPrompt}\n`;
                } else {
                    // LẦN 2 (NẾU LỖI BẢN QUYỀN): Lôi hàm xào bài theo môn học ra xài
                    currentInstruction = `\n2. ` + getSmartPrompt(teachingSubject, customPrompt) + `\n`;
                }

                // 2. RÁP LỆNH CHO AI
                const prompt = `Bạn là hệ thống trích xuất dữ liệu giáo dục. Hãy đọc tài liệu đính kèm và thực hiện:
                1. Tạo một Sơ đồ tư duy (Mindmap) tóm tắt (bằng gạch đầu dòng).
                ${currentInstruction}
                3. TUYỆT ĐỐI KHÔNG ĐƯỢC LƯỜI BIẾNG: Phải trích xuất ĐẦY ĐỦ 100% số câu.
                4. KHUNG QUẢN LÝ HÌNH ẢNH: Nếu câu gốc CÓ HÌNH ẢNH, hãy ghi chú vào mảng "teacher_image_notes".
                
                BẮT BUỘC TRẢ VỀ ĐỊNH DẠNG JSON CHUẨN (KHÔNG BỌC TRONG MARKDOWN \`\`\`):
                {
                    "mindmap": "Nội dung...",
                    "teacher_image_notes": [
                        { "cau_hien_tai": "Câu 1", "cau_goc": "Tương đương câu 5 gốc", "mo_ta_hinh_anh_can_chen": "Sơ đồ điện..." }
                    ],
                    "exam": [
                        {
                            "type": "nhiều lựa chọn",
                            "questionText": "Câu 1: Nội dung câu hỏi?",
                            "options": ["A. Đáp án 1", "B. Đáp án 2", "C. Đáp án 3", "D. Đáp án 4"],
                            "correctAnswer": "A"
                        }
                    ]
                }
                
                Nội dung: ${documentText || 'Dùng file đính kèm.'}`;

                try {
                    const model = genAI.getGenerativeModel({ model: currentModelName });
                    let responseText = "";

                    if (tempFilePath) {
                        const uploadResult = await fileManager.uploadFile(tempFilePath, { mimeType: req.file.mimetype, displayName: req.file.originalname });
                        const result = await model.generateContent([ prompt, { fileData: { fileUri: uploadResult.file.uri, mimeType: uploadResult.file.mimeType } } ]);
                        await fileManager.deleteFile(uploadResult.file.name);
                        responseText = result.response.text();
                    } else if (req.body.fileBase64) {
                        const result = await model.generateContent([ prompt, { inlineData: { data: req.body.fileBase64, mimeType: req.body.fileMimeType } } ]);
                        responseText = result.response.text();
                    } else {
                        const result = await model.generateContent(prompt);
                        responseText = result.response.text();
                    }

                    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                    finalResult = JSON.parse(responseText);
                    isSuccess = true;
                    console.log(`✅ THÀNH CÔNG!`);

                } catch (error) {
                    // XỬ LÝ QUAY XE KHI BỊ GÕ BẢN QUYỀN
                    if (error.message && error.message.includes('RECITATION')) {
                        if (!isRecitationMode) {
                            console.log(`⚠️ Google bắt bản quyền! Hệ thống QUAY XE, bật khiên xào bài môn [${teachingSubject}]...`);
                            isRecitationMode = true; // Bật cờ xào bài
                            j--; // Lùi lại 1 bước, CHẠY LẠI CHÍNH MÔ HÌNH VÀ KEY VỪA RỒI
                            continue; 
                        } else {
                            console.error(`❌ Đã xào bài rồi mà vẫn bắt bản quyền! Chịu chết!`);
                            throw new Error('RECITATION_ERROR_FATAL');
                        }
                    }
                    
                    console.log("⏳ Nghẽn mạng / Quá tải. Nhường đường 3s rồi đổi Key...");
                    await sleep(3000); 
                }
            }
        }

        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        
        if (isSuccess) return res.status(200).json({ data: finalResult });
        else return res.status(503).json({ message: "Các Key của sếp đã bị vắt kiệt. Chờ lúc khác tải lại nhé!" });

    } catch (error) {
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        if (error.message === 'RECITATION_ERROR_FATAL') return res.status(400).json({ message: "Lỗi Bản quyền: Đã thử xào bài nhưng Google quá gắt. Hãy cắt nhỏ đề ra thành 2 lần quét nhé!" });
        res.status(500).json({ message: "Lỗi kết nối máy chủ!" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Hệ thống đang nổ máy tại cổng ${PORT}`); });
