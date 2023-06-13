const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY)
const app = express();
const port = process.env.PORT || 5000;

//middleware
app.use(express.json());
app.use(cors());
//verify jwt middleware
const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    const token = authorization.split(" ")[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.uekolpg.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        const usersCollection = client.db('learnLanguage').collection('usersCollection');
        const courseCollection = client.db('learnLanguage').collection('courseCollection');
        const cartCollection = client.db('learnLanguage').collection('cartCollection');
        const paymentCollection = client.db('learnLanguage').collection('paymentCollection');

        app.get('/topInstructors', async (req, res) => {
            const query = { role: "instructor" };
            const result = await usersCollection.find(query).sort({ totalStudents: -1 }).toArray();
            res.send(result)
        });
        app.get('/topCourses', async (req, res) => {
            const result = await courseCollection.find().sort({ students: -1 }).toArray();
            res.send(result)
        })
        app.get('/instructors', async (req, res) => {
            const query = { role: "instructor" };
            const result = await usersCollection.find(query).toArray();
            res.send(result)
        });
        app.get('/courses', async (req, res) => {
            const result = await courseCollection.find({ status: "approved" }).toArray();
            res.send(result)
        })
        app.get('/users/:email', verifyJWT, async (req, res) => {
            const email = req.params.email
            if (req.decoded.email !== email) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const result = await usersCollection.findOne({ userEmail: email })
            res.send(result)
        })
        // initialiy get jwt token
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: '1h' });
            res.send(token)
        });
        // post new user
        app.post('/addUser', async (req, res) => {
            const userData = req.body;
            const findUser = await usersCollection.findOne({ userEmail: userData.userEmail })
            if (findUser) {
                return res.send({ available: 'available' })
            }
            const result = await usersCollection.insertOne(userData)
            res.send(result);
        });
        app.post('/addToCart', verifyJWT, async (req, res) => {
            const cartData = req.body;
            if (req.decoded.email !== cartData.userEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const findCourse = await cartCollection.findOne({ courseId: cartData.courseId });
            if (findCourse) {
                return res.send({ available: "available" })
            }
            const result = await cartCollection.insertOne(cartData);
            res.send(result);
        });
        app.get('/cartData/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const result = await cartCollection.find({ userEmail: email }).toArray();
            res.send(result);
        });
        app.delete('/deleteToCart', verifyJWT, async (req, res) => {
            const id = req.query.id
            if (req.decoded.email !== req.query.email) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });
        //create payment
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card'],
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            })
        });
        app.post('/payment', verifyJWT, async (req, res) => {
            const paymentData = req.body;
            const cartId = req.query.cartId;
            if (req.decoded.email !== req.query.email) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const query = { _id: new ObjectId(cartId) }
            const deleteResult = await cartCollection.deleteOne(query);
            const result = await paymentCollection.insertOne(paymentData);
            res.send({ result, deleteResult });
        });
        app.get('/paymentData/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const result = await paymentCollection.find({ userEmail: email }).sort({ date: -1 }).toArray();
            res.send(result)
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', async (req, res) => {
    res.send('LearnLanguage server running')
});
app.listen(port, () => {
    console.log('server is running');
})