const express = require('express')
const cors = require('cors')
const port = process.env.PORT || 5000
const app = express()
const jwt = require('jsonwebtoken')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

//middle ware
app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.xgyce0q.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

 function verifyJWT(req, res, next){
    const authHeader = req.headers.authorization;
    if(!authHeader){
        return res.status(401).send('unauthorized access')
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function(err, decoded){
        if(err){
            return res.status(403).send({message: 'forbidden access'})
        }
         req.decoded = decoded;
         next()
    })

 }
 async function run(){
    try{
        const appointmentOptionCollection = client.db('Doctors-Portal').collection('AppointmentOptions')
        const bookingCollection = client.db('Doctors-Portal').collection('bookings')
        const usersCollection = client.db('Doctors-Portal').collection('users')
        const doctorsCollection = client.db('Doctors-Portal').collection('doctors');
        const paymentsCollection = client.db('Doctors-Portal').collection('payments');
   //----------------------------appointment------------------------------------------
        app.get('/appointmentOption', async(req, res) => {
            const date = req.query.date
            const query = {}
            const options = await appointmentOptionCollection.find(query).toArray()

            const bookingQuery = {appointmentDate: date}
            const alreadyBooked = await bookingCollection.find(bookingQuery).toArray()

            options.forEach( option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name)
                const bookedSlot = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter( slot => !bookedSlot.includes(slot))
                option.slots = remainingSlots
             
            })
            res.send(options)
        })
        //specialty adding
        app.get('/appointmentSpecialty', async (req, res) => {
            const query = {}
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray();
            res.send(result);
        })

//------------------------------bookings-------------------------------------------------
        app.get('/bookings',verifyJWT, async( req,res) =>{
            const email = req.query.email
            const decodedEmail = req.decoded.email
            if(email !== decodedEmail){
                return res.status(403).send({message: 'forbidden access'})
            }
            const query = {email: email};
            // console.log(req.headers.authorization)
            const bookings =  await bookingCollection.find(query).toArray()
            res.send(bookings)
        })

        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        })

        app.post('/bookings', async(req, res) => {
            const booking = req.body
            const  query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatment: booking.treatment
            }
            const alreadyBooked = await bookingCollection.find(query).toArray()
           
            if(alreadyBooked.length){
                const message = `you already have a meeting on ${booking.appointmentDate}`
                return res.send({acknowledged: false, message})
            }
            const result = await bookingCollection.insertOne(booking)
            res.send(result)
        })
        //-----------------payment--------------------
        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });
        
        app.post('/payments', async (req, res) =>{
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId
            const filter = {_id: ObjectId(id)}
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingCollection.updateOne(filter, updatedDoc)
            res.send(result);
        })

    //-----------------------------jwt token-------------------------------
        app.get('/jwt', async(req, res) =>{
            const email  = req.query.email
            const query = {email :email}
            const user = await usersCollection.findOne(query)
            if(user){
                const token = jwt.sign({email}, process.env.ACCESS_TOKEN, {expiresIn: '1d'})
                 return res.send({accessToken: token})
            }
            console.log(user)
            res.status(403).send({accessToken: ''})

        })
//------------------------------users info-------------------------------------
      app.get('/users', async(req, res) =>{
        const query = {}
        const users = await usersCollection.find(query).toArray()
        res.send(users)
      })
   
        app.post('/users', async(req, res)=>{
            const user = req.body;
            const result = await usersCollection.insertOne(user)
            res.send(result);
        })
        app.put('/users/admin/:id',verifyJWT, async(req, res) =>{
            
            const decodedEmail = req.decoded.email;
            const query =  {email: decodedEmail}
            const user =  await usersCollection.findOne(query)

            if(user?.role != 'admin'){
                return res.status(403).send({message: 'forbidden access'})

            }
            const id =  req.params.id;
            const filter = {_id: ObjectId(id)}
            const options = {upsert: true}
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result  = await usersCollection.updateOne(filter, updatedDoc, options)
            res.send(result)
        })

        // temporary to update price field on appointment options
        // app.get('/addPrice', async (req, res) => {
        //     const filter = {}
        //     const options = { upsert: true }
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, options);
        //     res.send(result);
        // })

//----------------------------------doctor info--------------------------------------------
        app.get('/doctors',verifyJWT,  async (req, res) => {
            const query = {};
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors);
        })

        app.post('/doctors',verifyJWT,   async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });

        app.delete('/doctors/:id',verifyJWT,   async (req, res) => {
            const id = req.params.id;
            const filter = {_id: ObjectId(id)}
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        });



    }
    finally{

    }
 }
 run().catch(err => console.log(err))
app.get('/', async(req, res) => {
    res.send('doctor portal is running')
})

app.listen(port,() => {
    console.log(`doctor portal is running ${port}`)
})
