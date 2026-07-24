const uploadProductPermission = require("../../helpers/permission")
const PerfectForSuggestion = require("../../models/perfectForSuggestionModel")

// GET /api/perfect-for-suggestions?q=<partial-text>
// Returns top 6 suggestions whose text starts with q (case-insensitive), most-used first.
async function searchPerfectForSuggestions(req, res) {
    try {
        const q = (req.query.q || "").trim()

        if (!q) {
            return res.json({
                message: "Query required",
                success: true,
                error: false,
                data: []
            })
        }

        const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

        const matches = await PerfectForSuggestion.find({
            text: { $regex: `^${escapedQuery}`, $options: "i" }
        })
            .sort({ usageCount: -1 })
            .limit(6)

        res.json({
            message: "Suggestions found",
            success: true,
            error: false,
            data: matches
        })
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        })
    }
}

// POST /api/perfect-for-suggestions/save-or-increment
// body: { text, icon }
// Creates a new suggestion, or increments usageCount if text already exists (case-insensitive).
async function saveOrIncrementPerfectForSuggestion(req, res) {
    try {
        if (!uploadProductPermission(req.userId)) {
            throw new Error("Permission denied")
        }

        const { text, icon } = req.body

        if (!text || !icon) {
            throw new Error("text and icon are required")
        }

        const trimmedText = text.trim()

        const existing = await PerfectForSuggestion.findOne({
            text: { $regex: `^${trimmedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" }
        })

        if (existing) {
            existing.usageCount += 1
            existing.icon = icon
            const updated = await existing.save()

            return res.json({
                message: "Suggestion usage incremented",
                success: true,
                error: false,
                data: updated
            })
        }

        const created = await PerfectForSuggestion.create({
            text: trimmedText,
            icon,
            usageCount: 1
        })

        res.status(201).json({
            message: "Suggestion created",
            success: true,
            error: false,
            data: created
        })
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        })
    }
}

// DELETE /api/perfect-for-suggestions/:id
async function deletePerfectForSuggestion(req, res) {
    try {
        if (!uploadProductPermission(req.userId)) {
            throw new Error("Permission denied")
        }

        const { id } = req.params

        const deleted = await PerfectForSuggestion.findByIdAndDelete(id)

        if (!deleted) {
            throw new Error("Suggestion not found")
        }

        res.json({
            message: "Suggestion deleted",
            success: true,
            error: false,
            data: deleted
        })
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        })
    }
}

module.exports = {
    searchPerfectForSuggestions,
    saveOrIncrementPerfectForSuggestion,
    deletePerfectForSuggestion
}
