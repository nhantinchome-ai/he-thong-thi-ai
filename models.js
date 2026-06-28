const mongoose = require('mongoose');

// KHO CHỨA HỒ SƠ NGƯỜI DÙNG
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullname: { type: String, required: true },
    role: { type: String, required: true }, 
    grade: { type: String }, 
    studentClass: { type: String }, 
    teachingSubject: { type: String },
    homeroomClass: { type: String },
    teachingClasses: { type: String }
});

// KHO CHỨA BÀI THI CHỐNG GIAN LẬN
const AttemptSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    weekNumber: { type: Number, required: true }, 
    generatedQuestions: [{
        type: { type: String }, 
        questionText: String, 
        options: [String], 
        correctAnswer: String, 
        studentAnswer: { type: String, default: "" }, 
        pointsEarned: { type: Number, default: 0 } 
    }],
    totalScore: { type: Number, default: 0 }, 
    isGraded: { type: Boolean, default: false } 
}, { timestamps: true });

module.exports = {
    User: mongoose.model('User', UserSchema),
    Attempt: mongoose.model('Attempt', AttemptSchema)
};
