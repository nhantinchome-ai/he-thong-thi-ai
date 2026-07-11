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

// Cấu hình Multer nhận file từ Web
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } 
});

// Kết nối CSDL MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Đã thông mạch với MongoDB!"))
    .catch(err => console.error("❌ Lỗi kết nối MongoDB:", err));

// Định nghĩa Cấu trúc Dữ liệu Người dùng
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

// ==========================================
// CÁC API QUẢN LÝ TÀI KHOẢN (ĐĂNG NHẬP / ĐĂNG KÝ)
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
// TỪ ĐIỂN THẦN CHÚ LÁCH BẢN QUYỀN RIÊNG CHO 11 MÔN HỌC (SIÊU CHI TIẾT)
// ==========================================
function getSmartPrompt(subject, customPrompt) {
    let base = customPrompt && customPrompt.trim() !== "" ? `\nLệnh Tùy Chỉnh từ GV: ${customPrompt}\n` : "";
    const subj = (subject || "").toLowerCase();

    // 1. MÔN TOÁN
    if (subj.includes('toán')) {
        return base + `[CHỈ THỊ TỐI MẬT - MÔN TOÁN HỌC]: BẮT BUỘC viết lại (paraphrase) lời văn câu dẫn. Ví dụ: "Tìm x để..." -> "Hãy xác định giá trị của biến x sao cho...", "Tính đạo hàm..." -> "Đạo hàm của hàm số sau là...". TUYỆT ĐỐI GIỮ NGUYÊN 100% mọi con số, biểu thức đại số, tọa độ, tích phân, ma trận, hình học và đáp án.`;
    } 
    // 2. MÔN VẬT LÍ
    else if (subj.includes('lý') || subj.includes('vật lí')) {
        return base + `[CHỈ THỊ TỐI MẬT - MÔN VẬT LÍ]: BẮT BUỘC diễn đạt lại cách mô tả hiện tượng, tình huống vật lí bằng từ đồng nghĩa và cấu trúc câu khác. TUYỆT ĐỐI GIỮ NGUYÊN 100% các đơn vị đo lường (m/s, kg, N, J, V, A, Ω...), các thông số kỹ thuật, công thức vật lí và đáp án đúng.`;
    } 
    // 3. MÔN HÓA HỌC
    else if (subj.includes('hóa')) {
        return base + `[CHỈ THỊ TỐI MẬT - MÔN HÓA HỌC]: BẮT BUỘC viết lại câu hỏi lý thuyết và mô tả thí nghiệm bằng cấu trúc câu khác. TUYỆT ĐỐI GIỮ NGUYÊN 100% công thức hóa học (H2O, Fe2O3...), hệ số cân bằng phương trình, khối lượng mol, điều kiện phản ứng (nhiệt độ, xúc tác) và số liệu bài toán.`;
    } 
    // 4. MÔN SINH HỌC
    else if (subj.includes('sinh')) {
        return base + `[CHỈ THỊ TỐI MẬT - MÔN SINH HỌC]: BẮT BUỘC diễn đạt lại câu dẫn lý thuyết, quy luật di truyền hoặc mô tả sinh thái bằng từ đồng nghĩa. TUYỆT ĐỐI GIỮ NGUYÊN 100% mã bộ ba (codon), trình tự ADN/ARN, tỉ lệ kiểu hình (VD: 9:3:3:1), thuật ngữ sinh học chuyên ngành và tên khoa học của loài.`;
    } 
    // 5. MÔN TIN HỌC / CÔNG NGHỆ THÔNG TIN
    else if (subj.includes('tin') || subj.includes('lập trình')) {
        return base + `[CHỈ THỊ TỐI MẬT - MÔN TIN HỌC]: BẮT BUỘC viết lại phần lời hỏi và mô tả bài toán. TUYỆT ĐỐI GIỮ NGUYÊN 100% các đoạn mã code (C++, Python, Pascal...), cú pháp câu lệnh, tên biến, thuật toán, bảng chân lý và kết quả đầu ra (Output).`;
    } 
    // 6. MÔN NGỮ VĂN
    else if (subj.includes('văn')) {
        return base + `[CHỈ THỊ TỐI MẬT - MÔN NGỮ VĂN]: BẮT BUỘC diễn đạt lại các câu hỏi đọc hiểu và nghị luận bằng cách thay thế ít nhất 35% từ vựng bằng từ đồng nghĩa, đảo vế câu. LƯU Ý CỰC KỲ QUAN TRỌNG: TUYỆT ĐỐI KHÔNG được thay đổi hay sửa câu chữ trong các ĐOẠN VĂN BẢN TRÍCH DẪN, ĐOẠN THƠ trong phần Đọc hiểu!`;
    } 
    // 7. MÔN LỊCH SỬ
    else if (subj.includes('sử')) {
        return base + `[CHỈ THỊ TỐI MẬT - MÔN LỊCH SỬ]: BẮT BUỘC viết lại câu hỏi đánh giá, phân tích sự kiện bằng cấu trúc câu hoàn toàn mới. TUYỆT ĐỐI GIỮ NGUYÊN 100% các ngày tháng năm, mốc thời gian, tên triều đại, tên nhân vật lịch sử, tên chiến dịch, hiệp ước và địa danh.`;
    } 
    // 8. MÔN ĐỊA LÍ
    else if (subj.includes('địa')) {
        return base + `[CHỈ THỊ TỐI MẬT - MÔN ĐỊA LÍ]: BẮT BUỘC diễn đạt lại các câu hỏi lý thuyết kinh tế - xã hội, địa hình bằng cách xào lại từ vựng. TUYỆT ĐỐI GIỮ NGUYÊN 100% các số liệu thống kê, tỉ lệ phần trăm, tọa độ địa lí, tên quốc gia, sông ngòi, khoáng sản và bảng số liệu/biểu đồ.`;
    } 
    // 9. MÔN GDCD / KINH TẾ & PHÁP LUẬT
    else if (subj.includes('gdcd') || subj.includes('pháp luật') || subj.includes('kinh tế')) {
        return base + `[CHỈ THỊ TỐI MẬT - MÔN GDCD / PHÁP LUẬT]: Với các câu hỏi tình huống đời sống/pháp luật, ĐƯỢC PHÉP thay đổi tên các nhân vật (VD: từ Anh A thành Anh X, Chị B thành Chị Y) và diễn đạt lại tình huống để tránh lỗi bản quyền. TUYỆT ĐỐI GIỮ NGUYÊN các Điều, Khoản của Luật và bản chất vi phạm/đáp án.`;
    } 
    // 10. MÔN TIẾNG ANH / NGOẠI NGỮ
    else if (subj.includes('anh') || subj.includes('ngoại ngữ') || subj.includes('english')) {
        return base + `[CHỈ THỊ TỐI MẬT - MÔN TIẾNG ANH]: BẮT BUỘC CHỈ viết lại (paraphrase) phần lời dẫn yêu cầu bằng tiếng Việt (hoặc tiếng Anh) ở đầu câu hỏi. TUYỆT ĐỐI GIỮ NGUYÊN 100% bài đọc hiểu (Reading passage), câu hỏi ngữ pháp, chỗ trống cần điền và 4 đáp án A, B, C, D. Không được dịch tiếng Anh sang tiếng Việt.`;
    } 
    // 11. MÔN CÔNG NGHỆ
    else if (subj.includes('công nghệ')) {
        return base + `[CHỈ THỊ TỐI MẬT - MÔN CÔNG NGHỆ]: BẮT BUỘC diễn đạt lại lời văn câu hỏi lý thuyết và quy trình kỹ thuật. TUYỆT ĐỐI GIỮ NGUYÊN 100% các thông số kỹ thuật, kích thước bản vẽ, chi tiết cơ khí/mạch điện và các bước quy trình chuẩn.`;
    } 
    // MẶC ĐỊNH CHO CÁC MÔN KHÁC
    else {
        return base + `[CHỈ THỊ TỐI MẬT - CHUNG]: Bắt buộc diễn đạt lại câu hỏi bằng từ đồng nghĩa và đảo cấu trúc câu để không trùng lặp văn bản gốc. Giữ nguyên 100% dữ liệu cốt lõi, số liệu và đáp án.`;
    }
}

// ==========================================
// BỘ NÃO AI OCR - XOAY MODEL TRƯỚC -> KEY SAU (CHỐNG LƯỜI 100%)
// ==========================================
app.post('/api/tao-de-thi', upload.single('file'), async (req, res) => {
    let tempFilePath = null;
    try {
        const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k !== "");
        if (apiKeys.length === 0) return res.status(500).json({ message: "Server chưa cấu hình API Key!" });

        // DANH SÁCH MODEL (Vắt kiệt con 3.5 trước trên tất cả các Key rồi mới hạ đời)
        const modelsToTry = [
            "gemini-3.5-flash",       // Quái vật số 1: Thông minh, nhanh, đọc đủ câu
            "gemini-1.5-pro",         // Dự phòng 1: Trâu bò, đọc siêu chuẩn (nếu key hỗ trợ)
            "gemini-1.5-flash",       // Dự phòng 2: Ổn định cao
            "gemini-3.1-flash-lite"   // Đường cùng mới xài: Bản rút gọn siêu nhẹ
        ];

        const teachingSubject = req.body.teachingSubject || "Mặc định"; 
        const documentText = req.body.documentText;
        const customPrompt = req.body.customPrompt; 

        if (req.file) {
            tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}_${req.file.originalname}`);
            fs.writeFileSync(tempFilePath, req.file.buffer);
        }

        let isSuccess = false;
        let finalResult = null;
        let isRecitationMode = false; // Cờ theo dõi bản quyền

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // 🔥 VÒNG LẶP NGOÀI: CHỌN MODEL TRƯỚC (ĐÚNG Ý SẾP)
        for (let j = 0; j < modelsToTry.length; j++) {
            if (isSuccess) break;
            const currentModelName = modelsToTry[j];

            // 🔥 VÒNG LẶP TRONG: VẮT KIỆT TẤT CẢ API KEYS CHO MODEL NÀY
            for (let i = 0; i < apiKeys.length; i++) {
                if (isSuccess) break;
                
                const currentKey = apiKeys[i];
                const genAI = new GoogleGenerativeAI(currentKey);
                const fileManager = new GoogleAIFileManager(currentKey);
                
                let modeText = isRecitationMode ? "⚡ CHẾ ĐỘ XÀO BÀI" : "🔰 CHẾ ĐỘ NGUYÊN BẢN";
                console.log(`🔄 Đang thử: [Model ${currentModelName}] + [API Key ${i+1}/${apiKeys.length}] - Môn [${teachingSubject}] - ${modeText}...`);

                // 1. CHIA ĐƯỜNG CÂU LỆNH DỰA VÀO CỜ BẢN QUYỀN
                let currentInstruction = "";
                if (!isRecitationMode) {
                    currentInstruction = `\n2. NHIỆM VỤ OCR CHUẨN: BẮT BUỘC trích xuất chính xác 100% văn bản gốc. Tuyệt đối không được thêm bớt, tự ý tóm tắt hay sửa đổi bất kỳ từ ngữ nào của đề thi.\n`;
                    if (customPrompt) currentInstruction += `Lệnh tùy chỉnh từ GV: ${customPrompt}\n`;
                } else {
                    currentInstruction = `\n2. ` + getSmartPrompt(teachingSubject, customPrompt) + `\n`;
                }

                // 2. RÁP LỆNH CHO AI (CHỐNG LƯỜI BẬC NHẤT + KHUNG GIÁO VIÊN)
                const prompt = `Bạn là hệ thống trích xuất dữ liệu giáo dục. Hãy đọc tài liệu đính kèm và thực hiện:
                1. Tạo một Sơ đồ tư duy (Mindmap) tóm tắt (bằng gạch đầu dòng).
                ${currentInstruction}
                3. TUYỆT ĐỐI KHÔNG ĐƯỢC LƯỜI BIẾNG: Đề gốc có bao nhiêu câu (dù là 30 hay 40 câu) BẮT BUỘC phải trích xuất ĐẦY ĐỦ 100%. Không được tự ý tóm tắt, không được cắt xén bỏ sót câu nào!
                4. KHUNG QUẢN LÝ HÌNH ẢNH DÀNH CHO GIÁO VIÊN: Đối chiếu câu bạn vừa viết lại với câu trong đề gốc. Nếu câu đó ở đề gốc CÓ HÌNH ẢNH, hãy ghi chú lại vào mảng "teacher_image_notes" để nhắc giáo viên đính kèm hình. Nếu không có hình thì mảng này để trống.
                
                BẮT BUỘC TRẢ VỀ ĐỊNH DẠNG JSON CHUẨN (KHÔNG BỌC TRONG MARKDOWN \`\`\`):
                {
                    "mindmap": "Nội dung...",
                    "teacher_image_notes": [
                        { "cau_hien_tai": "Câu 1", "cau_goc": "Tương đương câu 5 đề gốc", "mo_ta_hinh_anh_can_chen": "Gắn hình sơ đồ quang hợp vào đây" }
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
                    console.log(`✅ THÀNH CÔNG RỰC RỠ với [Model ${currentModelName}] + [Key ${i+1}]!`);

                } catch (error) {
                    console.error(`❌ Thất bại với [Model ${currentModelName}] + [Key ${i+1}]:`, error.message);
                    
                    // CƠ CHẾ QUAY XE KHI BỊ GÕ BẢN QUYỀN
                    if (error.message && error.message.includes('RECITATION')) {
                        if (!isRecitationMode) {
                            console.log(`⚠️ Google bắt bản quyền! Hệ thống QUAY XE, bật khiên xào bài cho môn [${teachingSubject}]...`);
                            isRecitationMode = true; // Bật cờ xào bài
                            i--; // Lùi lại 1 bước, THỬ LẠI NGAY CHÍNH MODEL VÀ KEY NÀY!
                            continue; 
                        } else {
                            console.error(`❌ Đã xào bài rồi mà vẫn bắt bản quyền! Chuyển Key khác...`);
                        }
                    }
                    
                    // Lỗi 404 (Model không tồn tại cho Key này) hoặc 429/503 (Nghẽn/Hết Quota)
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
