const jwt = require('jsonwebtoken')

async function authToken(req, res, next) {
    try {
        const token = req.cookies?.token
        console.log("token", token);
        
        if (!token) {
            return res.status(401).json({
                message: "Please Login...!",
                error: true,
                success: false
            })
        }
        
        jwt.verify(token, process.env.TOKEN_SECRET_KEY, function(err, decoded) {
            if (err) {
                console.log("error auth", err);
                console.log("decoded", undefined);
                console.log("User ID from token: undefined");
                console.log("Final User ID stored in req: undefined");
                
                return res.status(401).json({
                    message: "Invalid token. Please login again.",
                    error: true,
                    success: false
                });
            }
            
            console.log("decoded", decoded);
            req.userId = decoded?._id;
            req.userRole = decoded?.role; 
            console.log("User ID from token:", decoded?._id);
            console.log("Final User ID stored in req:", req.userId);
            // console.log("User role from token:", req.userRole);
            
            if (!req.userId) {
                return res.status(401).json({
                    message: "User ID not found in token. Please login again.",
                    error: true,
                    success: false
                });
            }
            
            next();
        });
        
    } catch (err) {
        console.error("Unexpected error in auth middleware:", err);
        res.status(500).json({
            message: "Authentication error occurred",
            data: [],
            error: true,
            success: false
        });
    }
}

module.exports = authToken;
