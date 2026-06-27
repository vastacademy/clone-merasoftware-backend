async function userLogout (req,res){
    try {
        const tokenOption = {
            httpOnly : true,
            secure : true,
            sameSite : 'None',
            path: '/'
        };

        if (process.env.COOKIE_DOMAIN) {
            tokenOption.domain = process.env.COOKIE_DOMAIN;
        }

        res.clearCookie("token",tokenOption)

        res.json({
            message: "Logged out successfully",
            error: false,
            success: true,
            data: []
        })

    } catch (err) {
        res.json({
            message: err.message || err,
            error: true,
            success: false,
        })
    }
}

module.exports = userLogout
