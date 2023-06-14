const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const e = require('express');
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
        //verify admin
        const verifyAdmin = async (req, res, next) => {
            const email = req.params.email;
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const findAdmin = await usersCollection.findOne({ userEmail: email });
            if (findAdmin.role !== "admin") {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            next()
        }
        //verify Instrucor
        const verifyInstructor = async (req, res, next) => {
            const email = req.params.email;
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const findInstructor = await usersCollection.findOne({ userEmail: email });
            if (findInstructor.role !== "instructor") {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            next()
        }

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
            const result = await courseCollection.find({ status: "approved", role: 'instructor' }).toArray();
            res.send(result)
        })
        app.get('/users/:email', verifyJWT, async (req, res) => {
            const email = req.params.email
            if (req.decoded.email !== email) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const result = await usersCollection.findOne({ userEmail: email })
            res.send(result)
        });
        app.get('/allUsers/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
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
        app.post('/addToCart/:email', verifyJWT, async (req, res) => {
            const cartData = req.body;
            const email = req.params.email;
            if (req.decoded.email !== email) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const findEnrolledCourse = await paymentCollection.findOne({ courseId: cartData.courseId, userEmail: email })
            if (findEnrolledCourse) {
                return res.send({ enrolled: "enrolled" })
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
        });
        app.patch('/updateCourseInfo/:id', verifyJWT, async (req, res) => {
            const filter = { _id: new ObjectId(req.params.id) };
            const findCourse = await courseCollection.findOne(filter);
            const findInstructor = await usersCollection.findOne({ userEmail: findCourse.instructorEmail });
            const filter2 = { _id: new ObjectId(findInstructor._id) }
            const options = { upsert: true };
            const updateDoc1 = {
                $set: {
                    students: findCourse.students + 1,
                    availableSeat: findCourse.availableSeat - 1
                }
            }
            const result1 = await courseCollection.updateOne(filter, updateDoc1, options)
            const updateDoc2 = {
                $set: {
                    totalStudents: findInstructor.totalStudents ? findInstructor.totalStudents + 1 : 1
                }
            }
            const result2 = await usersCollection.updateOne(filter2, updateDoc2, options)
            res.send({ result1, result2 });
        })
        app.post('/addCourse/:email', verifyJWT, verifyInstructor, async (req, res) => {
            const courseData = req.body;
            const email = req.params.email;
            const filter = { userEmail: email };
            const findInstructor = await usersCollection.findOne(filter);
            const options = { upsert: true }
            if (findInstructor) {
                const updateDoc = {
                    $set: {
                        availableCourse: findInstructor.availableCourse ? findInstructor.availableCourse + 1 : 1
                    }
                }
                const result1 = await courseCollection.insertOne(courseData);
                const result2 = await usersCollection.updateOne(filter, updateDoc, options)
                res.send({ result1, result2 });
            }
        });
        app.get('/instructorCourse/:email', verifyJWT, verifyInstructor, async (req, res) => {
            const email = req.params.email;
            const result = await courseCollection.find({ instructorEmail: email }).sort({ date: -1 }).toArray()
            res.send(result)
        });
        app.get('/allCourse/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await courseCollection.find().sort({ date: -1 }).toArray();
            res.send(result);
        })
        app.get('/accessCourse/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const findCourse = await paymentCollection.find({ userEmail: email }).toArray();
            const query = { _id: { $in: findCourse.map(course => new ObjectId(course.courseId)) } }
            const result = await courseCollection.find(query).toArray();
            res.send(result);
        });
        app.patch('/changeStatus/:email/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const status = req.body;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    status: status.status
                }
            }
            const result = await courseCollection.updateOne(filter, updateDoc, options);
            res.send(result);
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