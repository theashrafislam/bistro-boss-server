const express = require('express')
const app = express()
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.STRIPE_payment_secret)
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());


const { MongoClient, ServerApiVersion, ObjectId, MongoAWSError } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gphdl2n.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
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
        // await client.connect();

        const menuCollection = client.db("bistro-boss").collection("menu");
        const reviewsCollection = client.db("bistro-boss").collection("reviews");
        const cartsCollection = client.db("bistro-boss").collection("carts");
        const usersCollection = client.db("bistro-boss").collection("users");
        const paymentsCollection = client.db("bistro-boss").collection("payments");

        //jwt related api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_CODE, { expiresIn: '1h' });
            res.send({ token });
        })
        //middleware
        const verifyToken = (req, res, next) => {
            console.log(req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_CODE, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access' });
                }
                req.decoded = decoded;
                next();
            })
        };

        // use verify admin after verifyToken
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'Forbidden access' })
            }
            next();
        }


        //admin related api
        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(401).send({ message: 'unauthorized access' })
            };
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user?.role === 'admin';
            }
            res.send({ admin });
        })


        //user related api
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            // insert email if user doesnt exists:
            // insert email if user doesnt exists:
            // you can do this many ways(1. email unique, 2. upsert 3. simple checking)
            const query = { email: user.email };
            const existsEmail = await usersCollection.findOne(query);
            if (existsEmail) {
                return res.send({ message: 'user already exists', insertedId: null })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })

        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(query);
            res.send(result);
        })


        //menu related api
        app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
            const item = req.body;
            const result = await menuCollection.insertOne(item);
            res.send(result);
        })
        app.delete('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        })
        app.get('/menu/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: id };
            const result = await menuCollection.findOne(query);
            res.send(result);
        })
        app.patch('/menu/:id', async (req, res) => {
            const info = req.body;
            const id = req.params.id;
            const filter = { _id: id };
            const updateDoc = {
                $set: {
                    name: info.name,
                    recipe: info.recipe,
                    category: info.category,
                    price: info.price,
                    image: info.image
                }
            }
            console.log(filter);
            const result = await menuCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        })
        app.get('/reviews', async (req, res) => {
            const result = await reviewsCollection.find().toArray();
            res.send(result);
        })

        //carts collection
        app.get('/carts', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await cartsCollection.find(query).toArray();
            res.send(result)
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartsCollection.deleteOne(query);
            res.send(result);
        })

        app.post('/carts', async (req, res) => {
            const foodItem = req.body;
            const result = await cartsCollection.insertOne(foodItem);
            res.send(result)
        })

        //payment related apis
        app.post("/create-payment-intent", async (req, res) => {
            const { price } = req.body;
            const amount = (price * 1000);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            })
        })

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentsCollection.insertOne(payment);

            //carefully delete each item from the cart
            console.log(payment)
            const query = {
                _id: {
                    $in: payment.cartIds.map(id => new ObjectId(id))
                }
            }
            const deleteResult = await cartsCollection.deleteMany(query);
            res.send({ paymentResult, deleteResult })
        })

        app.get('/payments/:email', verifyToken, async (req, res) => {
            const query = { email: req.params.email };
            if (req.params.email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const result = await paymentsCollection.find(query).toArray();
            res.send(result);
        })

        //stats or analytics
        app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
            const users = await usersCollection.estimatedDocumentCount();
            const menuItems = await menuCollection.estimatedDocumentCount();
            const orders = await paymentsCollection.estimatedDocumentCount();

            //working but this is not the best way.
            // const payments = await paymentsCollection.find().toArray();
            // const revenue = payments.reduce((total, payment) => total + payment.price, 0);

            const result = await paymentsCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRevenue: {
                            $sum: '$price'
                        }
                    }
                }
            ]).toArray();
            const revenue = result.length > 0 ? result[0].totalRevenue : 0;
            res.send({
                users,
                menuItems,
                orders,
                revenue
            })
        })

        //order status
        /**
         * --------------------------------------------
         *          NON - Efficient Way
         * ------------------------------------------
         * 1. load all the payments
        2. for every menuItemIds(which is an array), go dind the item from menu collection
        3. for every item in the menu collection that you found from a payment entry(document)
         */

        //using aggregate pipeline
        app.get('/order-stats', async (req, res) => {
            const result = await paymentsCollection.aggregate([
                {
                    $unwind: '$menuItemIds'
                },
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItemIds',
                        foreignField: '_id',
                        as: 'menuItems'
                    }
                },
                {
                    $unwind: '$menuItems'
                },
                {
                    $group: {
                        _id: '$menuItems.category',
                        quantity: { $sum: 1 },
                        revenue: { $sum: '$menuItems.price' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        category: '$_id',
                        quantity: '$quantity',
                        revenue: '$revenue'
                    }
                }
            ]).toArray();
            res.send(result)
        })





        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Hello World! Ok!')
})

app.listen(port, () => {
    console.log(`server port is runging. ${port}`)
})

/**
 * ---------------------------------------------------------
 *                  NAMING CONVENTION
 * ---------------------------------------------------------
 * app.get('/users')
 * app.get('/users/:id')
 * app.post('/users')
 * app.put('/users/:id')
 * app.patch('/users/:id')
 * app.delete('/users/:id')
 */