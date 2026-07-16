import cors from "cors"
import dotenv from "dotenv"
import express, { type NextFunction, type Request, type Response } from "express"
import { MongoClient, ObjectId, ServerApiVersion, type Document } from "mongodb"
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose-cjs"

dotenv.config()

const app = express()
const port = process.env.PORT ? Number(process.env.PORT) : 5000
const mongoUri = process.env.MONGODB_URI
const clientUrl = process.env.CLIENT_URL

if (!mongoUri) {
    throw new Error("MONGODB_URI is required")
}

if (!clientUrl) {
    throw new Error("CLIENT_URL is required")
}

app.use(cors())
app.use(express.json())

app.get("/", (_req: Request, res: Response) => {
    res.send("Hello World!")
})

const client = new MongoClient(mongoUri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
    }
})

// Serverless-friendly cached connection — bar bar connect na kore ekbar-i connect kore reuse kora hocche
let dbPromise: ReturnType<typeof client.connect> | null = null
const getDb = async () => {
    if (!dbPromise) {
        dbPromise = client.connect()
    }
    await dbPromise
    return client.db("digiHub")
}

const JWKS = createRemoteJWKSet(new URL(`${clientUrl}/api/auth/jwks`))

type AuthedRequest = Request & { user?: JWTPayload }
type ProductDocument = Document & {
    title?: string
    slug?: string
    category?: string
    brand?: string
    price?: number
    createdAt?: Date
    updatedAt?: Date
}

type ProductQuery = {
    search?: string
    category?: string
    brand?: string
    minPrice?: string
    maxPrice?: string
    sortBy?: string
    sortOrder?: string
    page?: string
    limit?: string
}

const verifyToken = async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization

    if (!authHeader) {
        return res.status(401).json({ message: "Unauthorized" })
    }

    const token = authHeader.split(" ")[1]

    if (!token) {
        return res.status(401).json({ message: "Unauthorized" })
    }

    try {
        const { payload } = await jwtVerify(token, JWKS)
        req.user = payload
        next()
    } catch {
        return res.status(401).json({ message: "Unauthorized" })
    }
}

app.get("/api/products", async (req: Request<unknown, unknown, unknown, ProductQuery>, res: Response) => {
    try {
        const db = await getDb()
        const allProducts = db.collection<ProductDocument>("products")

        const {
            search,
            category,
            brand,
            minPrice,
            maxPrice,
            sortBy = "createdAt",
            sortOrder = "desc",
            page = "1",
            limit = "10"
        } = req.query

        const filter: Record<string, unknown> = {}

        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: "i" } },
                { slug: { $regex: search, $options: "i" } },
                { category: { $regex: search, $options: "i" } },
                { brand: { $regex: search, $options: "i" } }
            ]
        }

        if (category) {
            filter.category = { $regex: category, $options: "i" }
        }

        if (brand) {
            filter.brand = { $regex: brand, $options: "i" }
        }

        const priceFilter: Record<string, number> = {}

        if (minPrice) {
            priceFilter.$gte = Number(minPrice)
        }

        if (maxPrice) {
            priceFilter.$lte = Number(maxPrice)
        }

        if (Object.keys(priceFilter).length > 0) {
            filter.price = priceFilter
        }

        const pageNumber = Math.max(Number(page) || 1, 1)
        const pageSize = Math.max(Number(limit) || 10, 1)
        const skip = (pageNumber - 1) * pageSize
        const direction = sortOrder.toLowerCase() === "asc" ? 1 : -1

        const [items, total] = await Promise.all([
            allProducts
                .find(filter)
                .sort({ [sortBy]: direction })
                .skip(skip)
                .limit(pageSize)
                .toArray(),
            allProducts.countDocuments(filter)
        ])

        res.json({
            items,
            total,
            page: pageNumber,
            limit: pageSize,
            totalPages: Math.ceil(total / pageSize)
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal Server Error"
        res.status(500).json({ error: message })
    }
})

app.get("/api/products/latest", async (_req: Request, res: Response) => {
    try {
        const db = await getDb()
        const allProducts = db.collection<ProductDocument>("products")
        const result = await allProducts.find().sort({ createdAt: -1 }).limit(4).toArray()

        res.json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal Server Error"
        res.status(500).json({ error: message })
    }
})

app.get("/api/products/:slug", verifyToken, async (req: Request, res: Response) => {
    try {
        const db = await getDb()
        const allProducts = db.collection<ProductDocument>("products")
        const product = await allProducts.findOne({ slug: req.params.slug })

        if (!product) {
            return res.status(404).json({ message: "Product not found" })
        }

        res.json(product)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal Server Error"
        res.status(500).json({ error: message })
    }
})

app.post("/api/products", verifyToken, async (req: AuthedRequest, res: Response) => {
    try {
        const db = await getDb()
        const allProducts = db.collection<ProductDocument>("products")
        const product = req.body as ProductDocument
        const now = new Date()

        if (!product?.title || !product?.slug) {
            return res.status(400).json({ message: "title and slug are required" })
        }

        const result = await allProducts.insertOne({
            ...product,
            createdAt: now,
            updatedAt: now
        })

        res.status(201).json({
            message: "Product created successfully",
            insertedId: result.insertedId
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal Server Error"
        res.status(500).json({ error: message })
    }
})

app.delete("/api/products/:id", verifyToken, async (req: AuthedRequest, res: Response) => {
    try {
        const db = await getDb()
        const allProducts = db.collection<ProductDocument>("products")
        const { id } = req.params
        const productId = Array.isArray(id) ? id[0] : id

        if (!productId) {
            return res.status(400).json({ message: "Invalid product id" })
        }

        if (!ObjectId.isValid(productId)) {
            return res.status(400).json({ message: "Invalid product id" })
        }

        const result = await allProducts.deleteOne({ _id: new ObjectId(productId) })

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Product not found" })
        }

        res.json({ message: "Product deleted successfully" })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal Server Error"
        res.status(500).json({ error: message })
    }
})

// Local dev-e normal server chalabe, Vercel-e app.listen() dorkar nei — Vercel nijei request handle kore
if (!process.env.VERCEL) {
    app.listen(port, () => {
        console.log(`Example app listening on port ${port}`)
    })
}

export default app

// https://digihub-zeta.vercel.app
// https://digihub-server.vercel.app/
