const userModel = require("../../models/userModel");

async function allUsers (req,res){
    try {
        console.log("userid all users",req.userId);

        const filter = {};
        if (req.query.referredBy) {
            filter.referredBy = req.query.referredBy;
        }

        const allUsers = await userModel.find(filter);

        res.json({
            message: "All User",
            data : allUsers,
            success : true,
            error: false
        })

        
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error : true,
            success : false
        })
    }
}

module.exports = allUsers; 