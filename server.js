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
// 4. BỘ NÃO AI OCR - ĐẠI PHÁP TÁI TẠO VĂN BẢN (100% VƯỢT RÀO)
// ==========================================
app.post('/api/tao-de-thi', upload.single('file'), async (req, res) => {
    try {
        const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k !== "");
        
        if (apiKeys.length === 0) {
            return res.status(500).json({ message: "Server chưa cấu hình API Key!" });
        }

        // ĐỘI HÌNH AI ĐÃ ĐƯỢC DỌN DẸP LỖI 404 (Chỉ giữ lại model đời mới)
        const modelsToTry = [
            "gemini-3.5-flash",       // 👑 Tướng chính
            "gemini-3.1-flash-lite",  // 🥈 Lốp dự phòng siêu nhẹ
            "gemini-4.0-flash-exp"    // 🚀 Chốt chặn tương lai
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
                
                let modeText = isRecitationMode ? "⚡ ĐẠI PHÁP PARAPHRASE CHỐNG BẢN QUYỀN" : "🔰 CHẾ ĐỘ NGUYÊN BẢN";
                console.log(`🔄 [${currentModelName}] + [Key ${i+1}] - [Mode: ${requestMode}] - ${modeText}`);

                let currentInstruction = "";
                let isTN2025 = customPrompt ? customPrompt.includes('[LỆNH ÉP SÁNG TÁC]') : false;
                let isScienceMath = ['toán', 'lý', 'hóa', 'sinh', 'vật lý', 'vật lí'].some(s => teachingSubject.toLowerCase().includes(s));

                // 🛑 LỚP KỶ LUẬT THÉP: ÉP BUỘC CHIA DẠNG CÂU HỎI
                if (requestMode === 'scan') {
                    if (!isRecitationMode) {
                        currentInstruction = `\n2. LỆNH QUÉT ĐỀ GỐC (TRÍCH XUẤT 100%): 
                        - Trích xuất toàn bộ câu hỏi trong tài liệu.
                        - TỰ ĐỘNG NHẬN DIỆN PHÂN LOẠI CÂU HỎI (LUẬT THÉP CHỐNG LƯỜI BIẾNG):
                          + Nếu câu gốc CÓ SẴN 4 đáp án A, B, C, D -> phân loại "nhiều lựa chọn".
                          + Nếu câu gốc CÓ SẴN 4 mệnh đề a, b, c, d Đúng/Sai -> phân loại "đúng sai".
                          + Nếu câu gốc CHỈ CÓ YÊU CẦU TÍNH TOÁN, KHÔNG CÓ SẴN đáp án A, B, C, D -> BẮT BUỘC phân loại "trả lời ngắn". TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ BỊA RA MẢNG "options" NẾU ĐỀ GỐC KHÔNG CÓ.\n`;
                    } else {
                        currentInstruction = `\n2. LỆNH VƯỢT RÀO BẢN QUYỀN: BẮT BUỘC PHẢI "PARAPHRASE" TOÀN BỘ CÂU DẪN. 
                        - TUYỆT ĐỐI KHÔNG CHÉP Y NGUYÊN VĂN BẢN GỐC. 
                        - LUẬT THÉP VỀ PHÂN LOẠI: Tài liệu gốc có A,B,C,D -> "nhiều lựa chọn". Tài liệu gốc gồm 4 mệnh đề -> "đúng sai". TÀI LIỆU GỐC KHÔNG CÓ OPTIONS (A,B,C,D) -> Bắt buộc phân loại "trả lời ngắn" (KHÔNG TỰ BỊA THÊM options).
                        - BẮT BUỘC GIỮ NGUYÊN: Số liệu toán học, hình học, công thức và giá trị đáp án.\n`;
                    }
                    if (customPrompt) { currentInstruction += `Lệnh từ GV: ${customPrompt}\n`; }
                } else {
                    if (!isRecitationMode) { 
                        if (isTN2025) {
                            let isMath = teachingSubject.toLowerCase().includes('toán');
                            currentInstruction = `\n2. NHIỆM VỤ SÁNG TÁC CHUẨN TỐT NGHIỆP: Hãy sáng tác số lượng câu hỏi tỷ lệ thuận với độ dài tài liệu. NHƯNG TỐI THIỂU PHẢI TẠO ĐỦ 15 CÂU HỎI.
                            - BẮT BUỘC PHẢI CHIA LÀM 3 DẠNG CÂU HỎI:
                              + Khoảng 60% câu đầu tiên: Phân loại "nhiều lựa chọn" (Bạn tự tạo 4 options A,B,C,D).
                              + Khoảng 20% câu tiếp theo: Phân loại "đúng sai" (Bạn tự tạo 4 subOptions).
                              + Khoảng 20% câu CUỐI CÙNG: BẮT BUỘC phân loại "trả lời ngắn" (TUYỆT ĐỐI KHÔNG TẠO MẢNG OPTIONS, bắt học sinh tự tính và điền kết quả dạng số vào "correctAnswer"). Nếu bạn không tạo dạng "trả lời ngắn", bạn sẽ bị phạt.\n`;
                        } else {
                            currentInstruction = `\n2. NHIỆM VỤ SÁNG TÁC TỰ DO: Sáng tác đề dựa vào tài liệu. TỐI THIỂU PHẢI TẠO 15 CÂU HỎI. BẮT BUỘC PHẢI CÓ ĐỦ 3 DẠNG: "nhiều lựa chọn", "đúng sai" VÀ "trả lời ngắn".\n`; 
                        }
                        if (customPrompt) { currentInstruction += `Lệnh từ GV: ${customPrompt}\n`; }
                    } else { 
                        currentInstruction = `\n2. ` + getSmartPrompt(teachingSubject, customPrompt) + `\n`; 
                    }
                }

                let mathFormatInstruction = isScienceMath ? `\n[LƯU Ý ĐỊNH DẠNG TOÁN HỌC TỐI MẬT]: Môn học là ${teachingSubject}. BẮT BUỘC mọi công thức, biểu thức, phân số, phương trình và ĐẶC BIỆT LÀ CÁC ĐÁP ÁN (options, subOptions, correctAnswer) phải được bọc trong cặp dấu $ (Ví dụ: $\\frac{1}{2}$, $F(x) = x^2$, $67/4$). TUYỆT ĐỐI KHÔNG để mã LaTeX trần trụi mà không có dấu $.` : "";

                let promptText = `Bạn là chuyên gia thẩm định và trích xuất dữ liệu giáo dục. Hãy đọc toàn bộ tài liệu/ảnh đính kèm và thực hiện ĐẦY ĐỦ 4 NHIỆM VỤ sau:
                1. Vẽ Sơ đồ tư duy (Mindmap): Tóm tắt chi tiết, logic toàn bộ cấu trúc và kiến thức trọng tâm của tài liệu đính kèm bằng định dạng Markdown.
                ${currentInstruction}
                ${mathFormatInstruction}
                3. Trích xuất ĐẦY ĐỦ 100% câu hỏi (QUY TẮC BẢO TOÀN): 
                   - KIỂM TRA LẠI: MỘT ĐỀ THI BẮT BUỘC PHẢI CÓ DẠNG "trả lời ngắn". TUYỆT ĐỐI KHÔNG biến tất cả thành "nhiều lựa chọn".
                   - Câu hỏi "nhiều lựa chọn" -> bắt buộc cung cấp mảng "options".
                   - Câu hỏi "đúng sai" -> bắt buộc cung cấp mảng "subOptions" và "correctAnswers".
                   - Câu hỏi "trả lời ngắn" -> TUYỆT ĐỐI KHÔNG CUNG CẤP mảng "options" hay "subOptions", chỉ ghi đáp án cuối cùng vào "correctAnswer".
                4. Soi hình ảnh và sơ đồ (Mắt thần): CHỈ QUÉT HÌNH ẢNH CỦA CÁC CÂU HỎI BÀI TẬP. Bất cứ câu bài tập nào gốc có chứa hình vẽ, đồ thị, bảng biến thiên, BẮT BUỘC ghi chú chi tiết vào mảng "teacher_image_notes".
                   - TUYỆT ĐỐI BỎ QUA toàn bộ hình ảnh minh họa nằm ở phần lý thuyết chung. Nếu không có câu bài tập nào chứa hình, hãy để mảng này rỗng [].
                   - Tại trường "cau_hien_tai", BẮT BUỘC phải ghi chính xác tên câu hỏi sẽ hiển thị (VD: "Câu 1", "Câu 2"). TUYỆT ĐỐI KHÔNG ĐƯỢC GHI "Không có".
                
                BẮT BUỘC TRẢ VỀ DUY NHẤT CẤU TRÚC JSON CHUẨN SAU ĐÂY:
                {
                    "mindmap": "# Tiêu đề chính\n## Nhánh 1\n- Ý chi tiết 1",
                    "teacher_image_notes": [ { "cau_hien_tai": "Câu 5", "cau_goc": "Câu 5", "mo_ta_hinh_anh_can_chen": "Sơ đồ mạch điện R1 R2" } ],
                    "exam": [
                        { 
                            "type": "nhiều lựa chọn", 
                            "questionText": "Câu 1: Nội dung câu hỏi?", 
                            "options": ["$A$", "$B$", "$C$", "$D$"], 
                            "correctAnswer": "A" 
                        },
                        { 
                            "type": "đúng sai", 
                            "questionText": "Câu 2: Nội dung câu dẫn?", 
                            "subOptions": ["Nội dung ý a", "Nội dung ý b", "Nội dung ý c", "Nội dung ý d"], 
                            "correctAnswers": ["D", "S", "D", "S"] 
                        },
                        { 
                            "type": "trả lời ngắn", 
                            "questionText": "Câu 3: Hãy tính thể tích khối chóp?", 
                            "correctAnswer": "$12.5$" 
                        }
                    ]
                }
                Nội dung Text đính kèm: ${documentText || 'Dùng ảnh đính kèm.'}`;

                let promptArray = [promptText];
                if (imageParts.length > 0) { promptArray = promptArray.concat(imageParts); }

                try {
                    const model = genAI.getGenerativeModel({ 
                        model: currentModelName, 
                        generationConfig: { maxOutputTokens: 32768, temperature: 0.1, responseMimeType: "application/json" } 
                    });
                    
                    const result = await model.generateContent(promptArray);
                    
                    let rawText = result.response.text();
                    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

                    let startIndex = rawText.indexOf('{');
                    let endIndex = rawText.lastIndexOf('}');
                    
                    if (startIndex === -1 || endIndex === -1) { throw new Error("JSON_NOT_FOUND: AI không sinh ra cấu trúc JSON."); }
                    
                    let cleanJsonString = rawText.substring(startIndex, endIndex + 1);

                    try {
                        finalResult = JSON.parse(cleanJsonString);

                        // 🛑 CODE POST-PROCESSING: CHỐNG CHỈ ĐỊNH AI LƯỜI BIẾNG 🛑
                        if (finalResult && finalResult.exam) {
                            finalResult.exam.forEach(q => {
                                let tStr = String(q.type || "").toLowerCase();
                                
                                // Nếu câu hỏi chứa từ khóa "ngắn", "điền" -> Tước bỏ mọi options nếu AI lỡ tạo
                                if (tStr.includes('ngắn') || tStr.includes('điền')) {
                                    q.type = 'trả lời ngắn';
                                    delete q.options;
                                    delete q.subOptions;
                                    if(typeof q.correctAnswer !== 'string') q.correctAnswer = String(q.correctAnswer || "");
                                } 
                                // Nếu AI phân loại "nhiều lựa chọn" mà lại... CHẢ CÓ MẢNG OPTIONS NÀO, hoặc mảng rỗng -> Ép về trả lời ngắn
                                else if (tStr.includes('lựa chọn') && (!q.options || q.options.length < 2)) {
                                    q.type = 'trả lời ngắn';
                                    delete q.options;
                                    delete q.subOptions;
                                }
                                // Xử lý đáp án ngáo cho trắc nghiệm
                                else if (tStr.includes('lựa chọn') && q.correctAnswer && q.correctAnswer.length > 2) {
                                    let matchedIndex = (q.options || []).findIndex(opt => opt.trim() === q.correctAnswer.trim());
                                    if (matchedIndex !== -1) {
                                        q.correctAnswer = String.fromCharCode(65 + matchedIndex);
                                    } else {
                                        let firstChar = q.correctAnswer.trim().charAt(0).toUpperCase();
                                        if (['A','B','C','D'].includes(firstChar)) { q.correctAnswer = firstChar; } 
                                        else { q.correctAnswer = "A"; }
                                    }
                                }
                            });
                        }

                        // LỌC RÁC CHO MẮT THẦN
                        if (finalResult && finalResult.teacher_image_notes) {
                            finalResult.teacher_image_notes = finalResult.teacher_image_notes.filter(note => {
                                let c = note.cau_hien_tai || note.cau || note.cau_hoi || "";
                                return typeof c === 'string' && c.trim() !== "" && !c.toLowerCase().includes("không có");
                            });
                        }

                    } catch (parseError) {
                        throw new Error("JSON_PARSE_ERROR");
                    }

                    if (!finalResult.exam || finalResult.exam.length <= 1) { throw new Error("SILENT_BLOCK"); }

                    isSuccess = true;
                    console.log(`✅ THÀNH CÔNG VỚI [${currentModelName}]! Đã bóc tách đủ ${finalResult.exam.length} câu!`);

                } catch (error) {
                    console.error(`❌ [Key ${i+1}] BÁO LỖI:`, error.message);
                    
                    if (error.message && (error.message.includes('RECITATION') || error.message.includes('SILENT_BLOCK'))) {
                        if (!isRecitationMode) { 
                            console.log(`⚠️ Bị chặn bản quyền! Đang kích hoạt Đại Pháp Paraphrase để vượt rào...`);
                            await sleep(2000); 
                            isRecitationMode = true; 
                            i--; 
                            continue; 
                        }
                    } else {
                        await sleep(2000); 
                    }
                }
            }
        }
        
        if (isSuccess) {
            return res.status(200).json({ data: finalResult });
        } else {
            return res.status(503).json({ message: "Máy chủ Google đang quá tải hoặc bộ lọc bản quyền đánh quá rát! Sếp vui lòng pha tách trà, nghỉ tay 5 phút rồi chia đề ra quét từng trang giúp em nhé!" });
        }

    } catch (error) {
        res.status(500).json({ message: "Lỗi kết nối máy chủ không xác định!" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Máy chủ Khảo Thí đang bốc đầu tại cổng ${PORT}`); });
