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

// Cấu hình Multer nhận file từ Web (Phòng hờ sếp dùng FormData)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } 
});

// ==========================================
// 1. KẾT NỐI CƠ SỞ DỮ LIỆU MONGODB
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Đã thông mạch với MongoDB!"))
    .catch(err => console.error("❌ Lỗi kết nối MongoDB:", err));

// Định nghĩa Cấu trúc Dữ liệu
const userSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'teacher', 'student'], default: 'student' },
    grade: String, studentClass: String, homeroomClass: String,
    teachingSubject: String, teachingClasses: String,
    createdAt: { type: Number, default: () => Date.now() } 
});
const User = mongoose.model('User', userSchema);

const ExamSchema = new mongoose.Schema({
    id: String, targetClass: String, category: String, subject: String,
    topic: String, duration: Number, mindmap: String, questions: Array,
    teacherName: String, createdAt: Number
});
const Exam = mongoose.model('Exam', ExamSchema);

const ScoreSchema = new mongoose.Schema({
    examId: String, topic: String, subject: String, teacherName: String,
    studentUsername: String, studentName: String, studentClass: String,
    score: String, time: String, attempt: Number, details: Array
});
const Score = mongoose.model('Score', ScoreSchema);


// ==========================================
// 2. CÁC API QUẢN LÝ TÀI KHOẢN (ĐĂNG NHẬP / ĐĂNG KÝ)
// ==========================================
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
// 3. CÁC API QUẢN LÝ ĐỀ THI & ĐIỂM SỐ
// ==========================================
app.post('/api/exams', async (req, res) => {
    try {
        const newExam = new Exam(req.body);
        await newExam.save();
        res.json({ success: true, message: 'Lưu đề thành công!' });
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
        res.json({ success: true, message: 'Đã xóa đề!' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/scores', async (req, res) => {
    try {
        const newScore = new Score(req.body);
        await newScore.save();
        res.json({ success: true, message: 'Lưu điểm thành công!' });
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
        res.json({ success: true, message: 'Đã xóa điểm!' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ==========================================
// TỪ ĐIỂN THẦN CHÚ LÁCH BẢN QUYỀN RIÊNG CHO 11 MÔN HỌC (GIỮ NGUYÊN BẢN GỐC CỦA SẾP)
// ==========================================
function getSmartPrompt(subject, customPrompt) {
    let base = customPrompt && customPrompt.trim() !== "" ? `\nLệnh Tùy Chỉnh từ GV: ${customPrompt}\n` : "";
    const subj = (subject || "").toLowerCase();

    if (subj.includes('toán')) return base + `[CHỈ THỊ TỐI MẬT - MÔN TOÁN HỌC]: BẮT BUỘC viết lại (paraphrase) lời văn câu dẫn. TUYỆT ĐỐI GIỮ NGUYÊN 100% mọi con số, biểu thức đại số, tọa độ, tích phân, ma trận, hình học và đáp án.`;
    else if (subj.includes('lý') || subj.includes('vật lí')) return base + `[CHỈ THỊ TỐI MẬT - MÔN VẬT LÍ]: BẮT BUỘC diễn đạt lại cách mô tả hiện tượng, tình huống vật lí. TUYỆT ĐỐI GIỮ NGUYÊN 100% các đơn vị đo lường, thông số kỹ thuật, công thức vật lí và đáp án đúng.`;
    else if (subj.includes('hóa')) return base + `[CHỈ THỊ TỐI MẬT - MÔN HÓA HỌC]: BẮT BUỘC viết lại câu hỏi lý thuyết. TUYỆT ĐỐI GIỮ NGUYÊN 100% công thức hóa học, hệ số cân bằng phương trình, điều kiện phản ứng và số liệu bài toán.`;
    else if (subj.includes('sinh')) return base + `[CHỈ THỊ TỐI MẬT - MÔN SINH HỌC]: BẮT BUỘC diễn đạt lại câu dẫn lý thuyết. TUYỆT ĐỐI GIỮ NGUYÊN 100% mã bộ ba (codon), trình tự ADN/ARN, tỉ lệ kiểu hình, thuật ngữ chuyên ngành.`;
    else if (subj.includes('tin') || subj.includes('lập trình')) return base + `[CHỈ THỊ TỐI MẬT - MÔN TIN HỌC]: BẮT BUỘC viết lại phần lời hỏi. TUYỆT ĐỐI GIỮ NGUYÊN 100% các đoạn mã code, cú pháp câu lệnh, tên biến, thuật toán.`;
    else if (subj.includes('văn')) return base + `[CHỈ THỊ TỐI MẬT - MÔN NGỮ VĂN]: BẮT BUỘC diễn đạt lại câu hỏi đọc hiểu bằng cách thay thế 35% từ vựng. TUYỆT ĐỐI KHÔNG sửa câu chữ trong ĐOẠN VĂN BẢN TRÍCH DẪN, ĐOẠN THƠ!`;
    else if (subj.includes('sử')) return base + `[CHỈ THỊ TỐI MẬT - MÔN LỊCH SỬ]: BẮT BUỘC viết lại câu hỏi đánh giá. TUYỆT ĐỐI GIỮ NGUYÊN 100% ngày tháng năm, mốc thời gian, tên nhân vật, chiến dịch, địa danh.`;
    else if (subj.includes('địa')) return base + `[CHỈ THỊ TỐI MẬT - MÔN ĐỊA LÍ]: BẮT BUỘC diễn đạt lại lý thuyết. TUYỆT ĐỐI GIỮ NGUYÊN 100% số liệu thống kê, tọa độ địa lí, tên quốc gia, sông ngòi, biểu đồ.`;
    else if (subj.includes('gdcd') || subj.includes('pháp luật') || subj.includes('kinh tế')) return base + `[CHỈ THỊ TỐI MẬT - GDCD]: Với câu hỏi tình huống, ĐƯỢC PHÉP thay đổi tên nhân vật và diễn đạt lại tình huống. TUYỆT ĐỐI GIỮ NGUYÊN các Điều, Khoản của Luật và bản chất vi phạm.`;
    else if (subj.includes('anh') || subj.includes('ngoại ngữ') || subj.includes('english')) return base + `[CHỈ THỊ TỐI MẬT - MÔN TIẾNG ANH]: BẮT BUỘC CHỈ viết lại lời dẫn bằng tiếng Việt (hoặc tiếng Anh). TUYỆT ĐỐI GIỮ NGUYÊN 100% bài đọc hiểu, câu hỏi ngữ pháp, 4 đáp án A, B, C, D.`;
    else if (subj.includes('công nghệ')) return base + `[CHỈ THỊ TỐI MẬT - MÔN CÔNG NGHỆ]: BẮT BUỘC diễn đạt lại lời văn. TUYỆT ĐỐI GIỮ NGUYÊN 100% thông số kỹ thuật, kích thước bản vẽ, quy trình chuẩn.`;
    else return base + `[CHỈ THỊ TỐI MẬT - CHUNG]: Bắt buộc diễn đạt lại câu hỏi bằng từ đồng nghĩa. Giữ nguyên 100% dữ liệu cốt lõi, số liệu và đáp án.`;
}

// ==========================================
// BỘ NÃO AI OCR - XOAY TUA MODEL/KEY & BẢO VỆ 15 CÂU
// ==========================================
app.post('/api/tao-de-thi', upload.single('file'), async (req, res) => {
    let tempFilePath = null;
    try {
        const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k !== "");
        if (apiKeys.length === 0) return res.status(500).json({ message: "Server chưa cấu hình API Key!" });

        const modelsToTry = [
            "gemini-3.5-flash",       
            "gemini-1.5-pro",         
            "gemini-1.5-flash",       
            "gemini-3.1-flash-lite"   
        ];

        const teachingSubject = req.body.teachingSubject || "Mặc định"; 
        const documentText = req.body.documentText;
        const customPrompt = req.body.customPrompt; 
        
        // HỖ TRỢ XỬ LÝ NHẬN ẢNH TỪ WEB (Dạng JSON Base64 hoặc Dạng FormData cũ)
        if (req.body.fileBase64) {
            let ext = '.png';
            if (req.body.fileMimeType === 'application/pdf') ext = '.pdf';
            else if (req.body.fileMimeType === 'image/jpeg') ext = '.jpg';
            tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}${ext}`);
            fs.writeFileSync(tempFilePath, Buffer.from(req.body.fileBase64, 'base64'));
        } else if (req.file) {
            tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}_${req.file.originalname}`);
            fs.writeFileSync(tempFilePath, req.file.buffer);
        }

        let isSuccess = false;
        let finalResult = null;
        let isRecitationMode = false; 

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (let j = 0; j < modelsToTry.length; j++) {
            if (isSuccess) break;
            const currentModelName = modelsToTry[j];

            for (let i = 0; i < apiKeys.length; i++) {
                if (isSuccess) break;
                
                const currentKey = apiKeys[i];
                const genAI = new GoogleGenerativeAI(currentKey);
                const fileManager = new GoogleAIFileManager(currentKey);
                
                let modeText = isRecitationMode ? "⚡ CHẾ ĐỘ XÀO BÀI" : "🔰 CHẾ ĐỘ NGUYÊN BẢN";
                console.log(`🔄 Đang thử: [Model ${currentModelName}] + [Key ${i+1}/${apiKeys.length}] - Môn [${teachingSubject}] - ${modeText}...`);

                let currentInstruction = "";
                if (!isRecitationMode) {
                    currentInstruction = `\n2. NHIỆM VỤ OCR CHUẨN: BẮT BUỘC trích xuất chính xác 100% văn bản gốc. Tuyệt đối không được thêm bớt, tự ý tóm tắt hay sửa đổi bất kỳ từ ngữ nào của đề thi.\n`;
                    if (customPrompt) currentInstruction += `Lệnh tùy chỉnh từ GV: ${customPrompt}\n`;
                } else {
                    currentInstruction = `\n2. ` + getSmartPrompt(teachingSubject, customPrompt) + `\n`;
                }

                // 🔥 LỆNH TỐI CAO: BỌC THÉP ÉP ĐẺ 15 CÂU
                const prompt = `Bạn là hệ thống trích xuất dữ liệu giáo dục. Hãy đọc tài liệu đính kèm và thực hiện:
                1. Tạo một Sơ đồ tư duy (Mindmap) tóm tắt (bằng gạch đầu dòng).
                ${currentInstruction}
                3. [CHỈ THỊ TỐI CAO - BẮT BUỘC KHÔNG ĐƯỢC LƯỜI]: Hãy sáng tác/trích xuất CHÍNH XÁC 15 CÂU HỎI. Cấu trúc cụ thể:
                   - TỪ CÂU 1 ĐẾN CÂU 12 (Đúng 12 câu): Thuộc loại "nhiều lựa chọn" (Có 4 đáp án A, B, C, D).
                   - TỪ CÂU 13 ĐẾN CÂU 15 (Đúng 3 câu): Thuộc loại "đúng sai" (Mỗi câu BẮT BUỘC phải chia 4 ý a,b,c,d vào mảng subOptions, đáp án D/S vào mảng correctAnswers).
                   KHÔNG ĐƯỢC LÀM THIẾU SỐ LƯỢNG 15 CÂU. TUYỆT ĐỐI KHÔNG GỘP CHUNG MỆNH ĐỀ.
                4. KHUNG QUẢN LÝ HÌNH ẢNH DÀNH CHO GIÁO VIÊN: Nếu câu đó ở đề gốc CÓ HÌNH ẢNH, hãy ghi chú lại vào mảng "teacher_image_notes".
                
                BẮT BUỘC TRẢ VỀ ĐỊNH DẠNG JSON CHUẨN (KHÔNG BỌC TRONG MARKDOWN \`\`\`):
                {
                    "mindmap": "Nội dung...",
                    "teacher_image_notes": [],
                    "exam": [
                        {
                            "type": "nhiều lựa chọn",
                            "questionText": "Câu 1: Nội dung câu hỏi?",
                            "options": ["A. Đáp án 1", "B. Đáp án 2", "C. Đáp án 3", "D. Đáp án 4"],
                            "correctAnswer": "A"
                        },
                        {
                            "type": "đúng sai",
                            "questionText": "Câu 13: Nội dung câu dẫn mệnh đề đúng/sai?",
                            "subOptions": ["Mệnh đề 1", "Mệnh đề 2", "Mệnh đề 3", "Mệnh đề 4"],
                            "correctAnswers": ["D", "S", "D", "S"]
                        }
                    ]
                }
                
                Nội dung: ${documentText || 'Dùng file đính kèm.'}`;

                try {
                    const model = genAI.getGenerativeModel({ model: currentModelName, generationConfig: { responseMimeType: "application/json" } });
                    let responseText = "";

                    if (tempFilePath) {
                        let mimeTypeToUse = req.file ? req.file.mimetype : req.body.fileMimeType;
                        let nameToUse = req.file ? req.file.originalname : `upload_${Date.now()}`;

                        const uploadResult = await fileManager.uploadFile(tempFilePath, { mimeType: mimeTypeToUse, displayName: nameToUse });
                        const result = await model.generateContent([ prompt, { fileData: { fileUri: uploadResult.file.uri, mimeType: uploadResult.file.mimeType } } ]);
                        await fileManager.deleteFile(uploadResult.file.name);
                        responseText = result.response.text();
                    } else {
                        const result = await model.generateContent(prompt);
                        responseText = result.response.text();
                    }

                    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                    finalResult = JSON.parse(responseText);
                    isSuccess = true;
                    console.log(`✅ THÀNH CÔNG RỰC RỠ với [Model ${currentModelName}] + [Key ${i+1}]!`);

                } catch (error) {
                    console.error(`❌ Thất bại với [Model ${currentModelName}] + [Key ${i+1}]:`, error.message);
                    
                    if (error.message && error.message.includes('RECITATION')) {
                        if (!isRecitationMode) {
                            console.log(`⚠️ Google bắt bản quyền! Hệ thống QUAY XE, bật khiên xào bài cho môn [${teachingSubject}]...`);
                            isRecitationMode = true; 
                            i--; 
                            continue; 
                        } else {
                            console.error(`❌ Đã xào bài rồi mà vẫn bắt bản quyền! Chuyển Key khác...`);
                        }
                    }
                    console.log("⏳ Kẹt mạng/Hết Quota Key này -> Kích hoạt phanh 3 giây rồi đổi Key tiếp theo...");
                    await sleep(3000); 
                }
            }
        }

        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        
        if (isSuccess) return res.status(200).json({ data: finalResult });
        else return res.status(503).json({ message: "Toàn bộ dàn Key và Model đã bị vắt kiệt. Sếp đợi một lúc rồi bấm quét lại nhé!" });

    } catch (error) {
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        res.status(500).json({ message: "Lỗi kết nối máy chủ không xác định, sếp tải lại trang thử xem!" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Hệ thống đang nổ máy tại cổng ${PORT}`); });
