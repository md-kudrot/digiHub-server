"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const mongodb_1 = require("mongodb");
const jose_cjs_1 = require("jose-cjs");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT ? Number(process.env.PORT) : 5000;
const mongoUri = process.env.MONGODB_URI;
const clientUrl = process.env.CLIENT_URL;
if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
}
if (!clientUrl) {
    throw new Error("CLIENT_URL is required");
}
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get("/", (_req, res) => {
    res.send("Hello World!");
});
const client = new mongodb_1.MongoClient(mongoUri, {
    serverApi: {
        version: mongodb_1.ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
    }
});
const JWKS = (0, jose_cjs_1.createRemoteJWKSet)(new URL(`${clientUrl}/api/auth/jwks`));
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    try {
        const { payload } = await (0, jose_cjs_1.jwtVerify)(token, JWKS);
        req.user = payload;
        next();
    }
    catch {
        return res.status(401).json({ message: "Unauthorized" });
    }
};
async function run() {
    try {
        await client.connect();
        const database = client.db("digiHub");
        const allProducts = database.collection("products");
        app.get("/api/products", async (req, res) => {
            try {
                const { search, category, brand, minPrice, maxPrice, sortBy = "createdAt", sortOrder = "desc", page = "1", limit = "10" } = req.query;
                const filter = {};
                if (search) {
                    filter.$or = [
                        { title: { $regex: search, $options: "i" } },
                        { slug: { $regex: search, $options: "i" } },
                        { category: { $regex: search, $options: "i" } },
                        { brand: { $regex: search, $options: "i" } }
                    ];
                }
                if (category) {
                    filter.category = { $regex: category, $options: "i" };
                }
                if (brand) {
                    filter.brand = { $regex: brand, $options: "i" };
                }
                const priceFilter = {};
                if (minPrice) {
                    priceFilter.$gte = Number(minPrice);
                }
                if (maxPrice) {
                    priceFilter.$lte = Number(maxPrice);
                }
                if (Object.keys(priceFilter).length > 0) {
                    filter.price = priceFilter;
                }
                const pageNumber = Math.max(Number(page) || 1, 1);
                const pageSize = Math.max(Number(limit) || 10, 1);
                const skip = (pageNumber - 1) * pageSize;
                const direction = sortOrder.toLowerCase() === "asc" ? 1 : -1;
                const [items, total] = await Promise.all([
                    allProducts
                        .find(filter)
                        .sort({ [sortBy]: direction })
                        .skip(skip)
                        .limit(pageSize)
                        .toArray(),
                    allProducts.countDocuments(filter)
                ]);
                res.json({
                    items,
                    total,
                    page: pageNumber,
                    limit: pageSize,
                    totalPages: Math.ceil(total / pageSize)
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : "Internal Server Error";
                res.status(500).json({ error: message });
            }
        });
        app.get("/api/products/latest", async (_req, res) => {
            try {
                const result = await allProducts.find().sort({ createdAt: -1 }).limit(4).toArray();
                res.json(result);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : "Internal Server Error";
                res.status(500).json({ error: message });
            }
        });
        app.get("/api/products/:slug", async (req, res) => {
            try {
                const product = await allProducts.findOne({ slug: req.params.slug });
                if (!product) {
                    return res.status(404).json({ message: "Product not found" });
                }
                res.json(product);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : "Internal Server Error";
                res.status(500).json({ error: message });
            }
        });
        app.post("/api/products", verifyToken, async (req, res) => {
            try {
                const product = req.body;
                const now = new Date();
                if (!product?.title || !product?.slug) {
                    return res.status(400).json({ message: "title and slug are required" });
                }
                const result = await allProducts.insertOne({
                    ...product,
                    createdAt: now,
                    updatedAt: now
                });
                res.status(201).json({
                    message: "Product created successfully",
                    insertedId: result.insertedId
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : "Internal Server Error";
                res.status(500).json({ error: message });
            }
        });
        app.delete("/api/products/:id", verifyToken, async (req, res) => {
            try {
                const { id } = req.params;
                const productId = Array.isArray(id) ? id[0] : id;
                if (!productId) {
                    return res.status(400).json({ message: "Invalid product id" });
                }
                if (!mongodb_1.ObjectId.isValid(productId)) {
                    return res.status(400).json({ message: "Invalid product id" });
                }
                const result = await allProducts.deleteOne({ _id: new mongodb_1.ObjectId(productId) });
                if (result.deletedCount === 0) {
                    return res.status(404).json({ message: "Product not found" });
                }
                res.json({ message: "Product deleted successfully" });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : "Internal Server Error";
                res.status(500).json({ error: message });
            }
        });
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
        app.listen(port, () => {
            console.log(`Example app listening on port ${port}`);
        });
    }
    catch (error) {
        console.error(error);
        process.exit(1);
    }
}
void run();
