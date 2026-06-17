const mongoose = require('mongoose');

// 1. Khu vực lưu Tài khoản (Học sinh & Giáo viên)
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullname: { type: String, required: true },
    role: { type: String, default: 'student' }, // student hoặc teacher
    grade: { type: String }, // Khối
    studentClass: { type: String } // Lớp
});

// 2. Khu vực lưu Bài làm của từng học sinh theo tuần (Chống quay cóp)
const AttemptSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    weekNumber: { type: Number, required: true }, // Số thứ tự tuần
    
    // Hệ thống sẽ lưu "chết" cái đề mà AI sinh ra riêng cho em này vào đây
    // Tránh việc tải lại trang là đề bị đổi thành đề khác
    generatedQuestions: [{
        type: { type: String, enum: ['trắc nghiệm', 'tự luận'] },
        questionText: String, // Nội dung câu hỏi (AI trộn dữ kiện)
        options: [String], // 4 đáp án (chỉ dùng cho trắc nghiệm)
        correctAnswer: String, // Đáp án đúng của máy
        studentAnswer: { type: String, default: "" }, // Câu trả lời của học sinh
        pointsEarned: { type: Number, default: 0 } // Điểm của từng câu
    }],
    
    totalScore: { type: Number, default: 0 }, // Tổng điểm thang 10
    isGraded: { type: Boolean, default: false } // Đánh dấu giáo viên đã vào chấm tay phần tự luận chưa
}, { timestamps: true });

module.exports = {
    User: mongoose.model('User', UserSchema),
    Attempt: mongoose.model('Attempt', AttemptSchema)
};