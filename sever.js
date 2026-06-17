const express = require('express');
const mongoose = require('mongoose');
const { GoogleGenAI } = require('@google/generative-ai');
const cors = require('cors');
const { User, Attempt } = require('./models');

const app = express();
app.use(express.json());
app.use(cors());

// 1. Kết nối thẳng vào kho dữ liệu MongoDB Atlas của bạn
const MONGODB_URI = "mongodb+srv://nhantinchome_db_user:S6g3Zz7iPUNXNieU@cluster0.gdn7qzm.mongodb.net/he_thong_thi_ai?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI)
  .then(() => console.log("=> Da ket noi thanh cong voi Kho du lieu MongoDB tren mang!"))
  .catch(err => console.error("=> Loi ket noi MongoDB:", err));

// 2. Cấu hình AI (Sẽ tự động lấy chìa khóa bí mật từ Render khi đưa lên mạng)
const aiSystem = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 3. Chức năng cốt lõi: Tạo đề thi chống gian lận cho từng học sinh
app.post('/api/tao-de-thi', async (req, res) => {
    try {
        const { studentId, weekNumber, topic } = req.body;

        // Báo cho AI biết luật chơi: 20 câu, có trắc nghiệm, có tự luận, đảo ngẫu nhiên
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
        
        // Dọn dẹp văn bản thừa để lấy đúng chuẩn JSON AI trả về
        const rawText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const questionsData = JSON.parse(rawText);

        // Lưu chết cái đề này vào Database khóa lại cho riêng học sinh này ở tuần này
        const newAttempt = new Attempt({
            studentId: studentId,
            weekNumber: weekNumber,
            generatedQuestions: questionsData
        });
        await newAttempt.save();

        res.status(200).json({ message: "Hệ thống đã sinh đề và khóa đề thành công!", data: newAttempt });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Lỗi hệ thống khi gọi AI tạo đề thi!" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`=> May chu dang chay, san sang phuc vu tai cong: ${PORT}`));