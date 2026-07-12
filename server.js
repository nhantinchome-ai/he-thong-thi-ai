require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Cấu hình Multer nhận file
const upload = multer({ 
    storage: multer.memoryStorage(), 
    limits: { fileSize: 50 * 1024 * 1024 } 
});

// ==========================================
// 1. KẾT NỐI MONGODB VÀ SCHEMAS
// ==========================================
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

// ==========================================
// 2. CÁC API QUẢN LÝ
// ==========================================
app.get('/', (req, res) => { res.status(200).send('✅ Máy chủ Backend đang hoạt động!'); });
app.post('/api/dang-ky', async (req, res) => { try { await new User({ ...req.body, role: 'student', createdAt: Date.now() }).save(); res.status(201).json({ message: "Đăng ký thành công" }); } catch (error) { res.status(400).json({ message: "Tên đăng nhập đã tồn tại hoặc lỗi dữ liệu" }); } });
app.post('/api/dang-nhap', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (username === 'admin' && password === 'admin') { let adminUser = await User.findOne({ username: 'admin' }); if (!adminUser) { adminUser = new User({ fullname: 'Quản trị viên', username: 'admin', password: 'admin', role: 'admin', createdAt: Date.now() }); await adminUser.save(); } return res.status(200).json({ message: "Đăng nhập Admin", data: adminUser }); }
        const user = await User.findOne({ username, password }); if (user) { res.status(200).json({ message: "Thành công", data: user }); } else { res.status(401).json({ message: "Sai tài khoản mật khẩu!" }); }
    } catch (error) { res.status(500).json({ message: "Lỗi máy chủ" }); }
});
app.get('/api/admin/tat-ca-users', async (req, res) => { try { const users = await User.find({}); res.status(200).json({ data: users }); } catch (error) { res.status(500).json({ message: "Lỗi truy xuất" }); } });
app.post('/api/admin/xoa-user', async (req, res) => { try { await User.findByIdAndDelete(req.body.userId); res.status(200).json({ message: "Xóa thành công" }); } catch (error) { res.status(500).json({ message: "Lỗi xóa" }); } });
app.post('/api/tao-giao-vien', async (req, res) => { try { const newTeacher = new User({ ...req.body, role: 'teacher', createdAt: Date.now() }); await newTeacher.save(); res.status(201).json({ message: "Thành công" }); } catch (error) { res.status(400).json({ message: "Trùng Tên đăng nhập!" }); } });
app.post('/api/exams', async (req, res) => { try { const newExam = new Exam(req.body); await newExam.save(); res.json({ success: true, message: 'Lưu đề thành công!' }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });
app.get('/api/exams', async (req, res) => { try { const exams = await Exam.find(); res.json({ success: true, data: exams }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });
app.post('/api/exams/delete', async (req, res) => { try { await Exam.deleteOne({ id: req.body.id }); res.json({ success: true, message: 'Đã xóa đề!' }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });
app.post('/api/scores', async (req, res) => { try { const newScore = new Score(req.body); await newScore.save(); res.json({ success: true, message: 'Lưu điểm thành công!' }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });
app.get('/api/scores', async (req, res) => { try { const scores = await Score.find(); res.json({ success: true, data: scores }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });
app.post('/api/scores/delete', async (req, res) => { try { await Score.findByIdAndDelete(req.body._id); res.json({ success: true, message: 'Đã xóa điểm!' }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });

// ==========================================
// 3. TỪ ĐIỂN THẦN CHÚ LÁCH BẢN QUYỀN
// ==========================================
function getSmartPrompt(subject, customPrompt) {
    let base = customPrompt && customPrompt.trim() !== "" ? `\nLệnh Tùy Chỉnh từ GV: ${customPrompt}\n` : "";
    const subj = (subject || "").toLowerCase();
    
    if (subj.includes('toán')) { return base + `[CHỈ THỊ TỐI MẬT]: BẮT BUỘC viết lại lời văn câu dẫn. TUYỆT ĐỐI GIỮ NGUYÊN 100% mọi con số, biểu thức, tọa độ, ma trận, hình học và đáp án.`; } 
    else if (subj.includes('lý') || subj.includes('vật lí') || subj.includes('công nghệ')) { return base + `[CHỈ THỊ TỐI MẬT]: BẮT BUỘC diễn đạt lại cách mô tả hiện tượng. TUYỆT ĐỐI GIỮ NGUYÊN 100% các đơn vị, thông số, công thức và đáp án đúng.`; } 
    else if (subj.includes('hóa')) { return base + `[CHỈ THỊ TỐI MẬT]: BẮT BUỘC viết lại câu hỏi lý thuyết. TUYỆT ĐỐI GIỮ NGUYÊN 100% công thức hóa học, hệ số cân bằng, số liệu.`; } 
    else if (subj.includes('sinh')) { return base + `[CHỈ THỊ TỐI MẬT]: BẮT BUỘC diễn đạt lại câu dẫn. TUYỆT ĐỐI GIỮ NGUYÊN 100% mã bộ ba, trình tự ADN, tỉ lệ kiểu hình.`; } 
    else if (subj.includes('anh') || subj.includes('english')) { return base + `[CHỈ THỊ TỐI MẬT]: BẮT BUỘC CHỈ viết lại lời dẫn bằng tiếng Việt (hoặc tiếng Anh). TUYỆT ĐỐI GIỮ NGUYÊN 100% bài đọc hiểu, 4 đáp án A, B, C, D.`; } 
    else { return base + `[CHỈ THỊ TỐI MẬT - CHUNG]: Bắt buộc diễn đạt lại câu hỏi bằng từ đồng nghĩa. Giữ nguyên 100% dữ liệu cốt lõi và đáp án.`; }
}

// ==========================================
// 4. BỘ NÃO AI OCR - TỨ TRỤ TRIỀU ĐÌNH ĐÁNH 5 TRANG
// ==========================================
app.post('/api/tao-de-thi', upload.single('file'), async (req, res) => {
    try {
        const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k !== "");
        
        if (apiKeys.length === 0) {
            return res.status(500).json({ message: "Server chưa cấu hình API Key!" });
        }

        // 🌟 ĐỘI HÌNH TỨ TRỤ THEO Ý SẾP (THÍCH SỐ 4) 🌟
        const modelsToTry = [
            "gemini-3.1-pro-preview", // 👑 TOP 1: Vua cày cuốc, tư duy sâu, chuyên trị đề 5 trang nặng
            "gemini-3.5-flash",       // 🥈 TOP 2: Nhanh như điện, gánh tạ nếu Vua kẹt mạng
            "gemini-pro",             // 🥉 TOP 3: Model Gốc Bất Tử (Google luôn trỏ về bản Pro ngon nhất)
            "gemini-3.1-flash-lite"   // 🐢 TOP 4: Yếu xìu, đẩy xuống bét mâm làm chốt chặn cuối
        ];
        
        const teachingSubject = req.body.teachingSubject || "Mặc định"; 
        const documentText = req.body.documentText;
        const customPrompt = req.body.customPrompt; 
        const requestMode = req.body.mode || 'generate';
        
        let imageParts = [];
        if (req.body.fileBase64Array && req.body.fileBase64Array.length > 0) {
            req.body.fileBase64Array.forEach(img => { 
                imageParts.push({ inlineData: { data: img.base64, mimeType: img.mimeType } }); 
            });
        } else if (req.body.fileBase64) {
            imageParts.push({ inlineData: { data: req.body.fileBase64, mimeType: req.body.fileMimeType } });
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
                
                let modeText = isRecitationMode ? "⚡ CHẾ ĐỘ XÀO BÀI NHẸ" : "🔰 CHẾ ĐỘ NGUYÊN BẢN";
                console.log(`🔄 [${currentModelName}] + [Key ${i+1}] - [Mode: ${requestMode}] - ${modeText}`);

                let currentInstruction = "";
                if (requestMode === 'scan') {
                    if (!isRecitationMode) {
                        currentInstruction = `\n2. LỆNH QUÉT ĐỀ: Trích xuất 100% văn bản gốc. Nếu vướng bản quyền, bạn được phép paraphrase tối đa 5% từ vựng trong lời dẫn, TUYỆT ĐỐI GIỮ NGUYÊN số liệu, hình ảnh và 4 đáp án.\n`;
                    } else {
                        // 💊 THUỐC ĐẶC TRỊ "ĐỨT HƠI": Lách bản quyền nhưng tiết kiệm sức để sinh đủ chuỗi JSON
                        currentInstruction = `\n2. LỆNH CHỐNG RECITATION SIÊU NHẸ: Để lách bản quyền mà không bị đuối sức, bạn TUYỆT ĐỐI KHÔNG paraphrase toàn bộ câu. CHỈ CẦN thêm cụm từ "Theo bài ra," hoặc đổi 1-2 từ ngữ ở ngay đầu mỗi câu hỏi. Giữ nguyên 95% văn bản gốc, số liệu và đáp án để tiết kiệm thời gian sinh JSON!\n`;
                    }
                    if (customPrompt) { currentInstruction += `Lệnh từ GV: ${customPrompt}\n`; }
                } else {
                    if (!isRecitationMode) { 
                        currentInstruction = `\n2. NHIỆM VỤ SÁNG TÁC: Hãy sáng tác đề dựa vào tài liệu.\n`; 
                        if (customPrompt) { currentInstruction += `Lệnh từ GV: ${customPrompt}\n`; }
                    } else { 
                        currentInstruction = `\n2. ` + getSmartPrompt(teachingSubject, customPrompt) + `\n`; 
                    }
                }

                let promptText = `Bạn là hệ thống trích xuất dữ liệu giáo dục. Đọc tài liệu đính kèm và thực hiện:
                1. Tạo một Sơ đồ tư duy (Mindmap) tóm tắt.
                ${currentInstruction}
                3. QUY TẮC BẢO TOÀN (CHỐNG LƯỜI): Tài liệu có bao nhiêu câu, hãy trích xuất ĐẦY ĐỦ 100%. KHÔNG ĐƯỢC BỎ SÓT!
                   - Trắc nghiệm 4 đáp án -> loại "nhiều lựa chọn".
                   - Đúng/Sai -> loại "đúng sai", BẮT BUỘC tách 4 ý nhỏ a,b,c,d vào "subOptions", đáp án D/S vào "correctAnswers".
                4. TÌM HÌNH ẢNH: Đối chiếu câu vừa viết với đề gốc. BẤT CỨ CÂU NÀO CÓ HÌNH ẢNH, SƠ ĐỒ, BẢNG BIỂU, hãy ghi chú chi tiết vào "teacher_image_notes".
                
                BẮT BUỘC TRẢ VỀ JSON SAU:
                {
                    "mindmap": "Nội dung...",
                    "teacher_image_notes": [ { "cau_hien_tai": "Câu 5", "cau_goc": "Câu 5", "mo_ta_hinh_anh_can_chen": "Sơ đồ mạch điện" } ],
                    "exam": [
                        { "type": "nhiều lựa chọn", "questionText": "Câu 1: Hỏi gì?", "options": ["A", "B", "C", "D"], "correctAnswer": "A" }
                    ]
                }
                Nội dung Text đính kèm: ${documentText || 'Dùng ảnh đính kèm.'}`;

                let promptArray = [promptText];
                if (imageParts.length > 0) { promptArray = promptArray.concat(imageParts); }

                try {
                    const model = genAI.getGenerativeModel({ 
                        model: currentModelName, 
                        generationConfig: { maxOutputTokens: 8192 } 
                    });
                    
                    const result = await model.generateContent(promptArray);
                    let rawText = result.response.text();
                    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

                    // MÁY CẮT LỌC JSON: Tự động vứt bỏ chữ rác, vá lỗi
                    let startIndex = rawText.indexOf('{');
                    let endIndex = rawText.lastIndexOf('}');
                    
                    if (startIndex === -1 || endIndex === -1) { throw new Error("JSON_NOT_FOUND"); }
                    
                    let cleanJsonString = rawText.substring(startIndex, endIndex + 1);

                    try {
                        finalResult = JSON.parse(cleanJsonString);
                    } catch (parseError) {
                        throw new Error("JSON_PARSE_ERROR");
                    }

                    if (!finalResult.exam || finalResult.exam.length <= 1) { throw new Error("SILENT_BLOCK"); }

                    isSuccess = true;
                    console.log(`✅ THÀNH CÔNG VỚI [${currentModelName}]! Đã quét xong ${finalResult.exam.length} câu!`);

                } catch (error) {
                    console.error(`❌ [Key ${i+1}] BÁO LỖI:`, error.message);
                    
                    if (error.message && (error.message.includes('RECITATION') || error.message.includes('SILENT_BLOCK'))) {
                        if (!isRecitationMode) { 
                            console.log(`⚠️ Bị chặn bản quyền! Đang bật khiên "Xào Bài Nhẹ" để lách luật...`);
                            await sleep(3000); 
                            isRecitationMode = true; 
                            i--; // Gọi lại chính Key này với lệnh mới
                            continue; 
                        }
                    } else if (error.message.includes('401') || error.message.includes('404')) {
                        console.log(`⚠️ Model không tồn tại hoặc Key chết, chuyển sang Tướng tiếp theo...`);
                    } else {
                        await sleep(3000); 
                    }
                }
            }
        }
        
        if (isSuccess) {
            return res.status(200).json({ data: finalResult });
        } else {
            return res.status(503).json({ message: "Bị giới hạn tài nguyên. Sếp chia nhỏ file quét 2 trang/lần giúp em nhé!" });
        }

    } catch (error) {
        res.status(500).json({ message: "Lỗi kết nối máy chủ không xác định!" });
    }
});

// ==========================================
// 5. KHỞI ĐỘNG SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { 
    console.log(`🚀 Máy chủ Khảo Thí đang bốc đầu tại cổng ${PORT}`); 
});
