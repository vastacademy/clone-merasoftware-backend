const userModel = require("../../models/userModel");
const developerModel = require("../../models/developerModel");

async function updateUser(req,res){
    try{
        const sessionUser = req.userId

        const { userId , email, name, role} = req.body

        const payload = {
            ...( email && { email : email}),
            ...( name && { name : name}),
            ...( role && { role : role}),
        }

        const user = await userModel.findById(sessionUser)

        console.log("user.role",user.role)
 
         // Update the user
         const updatedUser = await userModel.findByIdAndUpdate(userId, payload, { new: true });
        
         // If role is changed to DEVELOPER, create a developer entry if it doesn't exist
         if (role === 'DEVELOPER') {
             // Check if developer already exists
             const existingDeveloper = await developerModel.findOne({ email: updatedUser.email });
             
             if (!existingDeveloper) {
                 // Create a new developer entry
                 const newDeveloper = new developerModel({
                     name: updatedUser.name,
                     email: updatedUser.email,
                     phone: updatedUser.phone || '0000000000',  // Default value if not available
                     designation: 'Junior Developer', // Default value
                     department: 'Full Stack',        // Default value
                     employeeId: `DEV-${Date.now().toString().slice(-6)}`, // Generate a simple ID
                     status: 'Available'
                 });
                 
                 await newDeveloper.save();
             }
         }

        res.json({
            data : updateUser,
            message : "User Updated",
            success : true,
            error : false
        })
    }catch(err){
        res.status(400).json({
            message : err.message || err,
            error : true,
            success : false
        })
    }
}


module.exports = updateUser 