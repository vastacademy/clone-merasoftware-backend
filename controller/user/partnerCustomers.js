const userModel = require("../../models/userModel");
const orderModel = require("../../models/orderProductModel");
const transactionModel = require("../../models/transactionModel");
const mongoose = require("mongoose");

async function getPartnerCustomers(req, res) {
    try {
        const partnerId = req.userId; // Assuming userId is set in auth middleware

        if (!partnerId) {
            return res.status(400).json({
                success: false,
                message: "Partner user ID is required"
            });
        }

        // Aggregate users referred by this partner with total purchases and total spend
        const customers = await userModel.aggregate([
            { $match: { referredBy: new mongoose.Types.ObjectId(partnerId) } },
            {
                $lookup: {
                    from: "orders", // Make sure this matches your actual collection name
                    localField: "_id",
                    foreignField: "userId",
                    as: "orders"
                }
            },
            {
                $lookup: {
                    from: "transactions", // Make sure this matches your actual collection name
                    let: { userId: "$_id" },
                    pipeline: [
                        { 
                            $match: { 
                                $expr: { 
                                    $and: [
                                        { $eq: ["$userId", "$$userId"] },
                                        { $eq: ["$status", "completed"] },
                                        { $eq: ["$type", "payment"] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "transactions"
                }
            },
            {
                $addFields: {
                    // Count approved/visible orders (actual purchases)
                    totalPurchases: { 
                        $size: {
                            $filter: {
                                input: "$orders",
                                as: "order",
                                cond: { 
                                    $in: ["$$order.orderVisibility", ["approved", "visible"]] 
                                }
                            }
                        }
                    },
                    // Calculate total spend from completed payment transactions
                    totalSpend: { 
                        $sum: {
                            $map: {
                                input: "$transactions",
                                as: "transaction",
                                in: "$$transaction.amount"
                            }
                        }
                    },
                    dateAdded: "$createdAt"
                }
            },
            {
                $project: {
                    name: 1,
                    email: 1,
                    phone: 1,
                    totalPurchases: 1,
                    totalSpend: 1,
                    dateAdded: 1,
                    // Optional: Add wallet balance if needed
                    walletBalance: 1
                }
            },
            {
                $sort: { dateAdded: -1 } // Sort by newest customers first
            }
        ]);

        res.json({
            success: true,
            message: "Partner customers fetched successfully",
            data: customers,
            totalCustomers: customers.length
        });
    } catch (error) {
        console.error("Error fetching partner customers:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch partner customers",
            error: error.message
        });
    }
}

module.exports = getPartnerCustomers;