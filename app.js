const express = require('express')
const path = require('path')
const logger = require('morgan')
const bodyParser = require('body-parser')
const neo4j = require('neo4j-driver')
const session = require('express-session')
const cookieParser = require('cookie-parser')
const sessionstore = require('sessionstore/lib/sessionstore')
const Pool = require('pg').Pool
let port = process.env.PORT || 3000

/**  postgres connection **/ 
const pool = new Pool({
    user: 'postgres',
    host:'localhost',
    database: 'sgdb_lab',
    password: 'ptb@321',
    port: 5432                  //Default port, change it if needed
});

const app = express()

app.set('view engine','ejs')

app.use(logger('dev'))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended:false}))
app.use(express.static(path.join(__dirname,'public')))


/**  neo4j connection **/
const driver = neo4j.driver('bolt://localhost',neo4j.auth.basic('neo4j','ptb@321'))
var sessions = driver.session()

// sessions
app.use(cookieParser())
app.use(session({
    secret: 'key that will sign cookie',
    resave:false,
    saveUninitialized:false,
    store:sessionstore.createSessionStore(),
}))

/** routes protection **/
const ensureAuth = (req,res,next)=>{
    if(req.session.isAuth){
        next();
    }else{
        res.redirect('/login')
    }
}

const ensureGuest = (req,res,next)=>{
    if(req.session.isAuth){
        res.redirect('profile')
    }else{
        return next()
    }
}

/** routes **/

// home
app.get('/',ensureGuest,(req,res)=>{
    res.render('home')
    
    pool.query('SELECT * FROM coviddata limit 5; select t.laa from polbnda_ind t limit 5;', function (err, result) {
                
                if (err) {
                    console.log(err);
                    res.status(400).send(err);                  
                }
            })
})

// about
app.get('/about',ensureGuest,(req,res)=>{
    res.render('aboutus')
})


// login
app.get('/login',(req,res)=>{
    res.render('login')
})

app.post('/login',async(req,res)=>{
    var name = req.body.name
    var email = req.body.email

    var user = await pool.query('Select * from coviddata where email=$1',[email])
    user = user.rows[0]
    // console.log(user)
    if(email==user.email){
    req.session.isAuth=true
        req.session.user = user
        req.session.save()
        res.render('profile',{profile:req.session.user})
        // console.log(req.session.user)
    }else{ 
        res.render('login')
    }
})

// profile
app.get('/profile',ensureAuth, async(req,res)=>{
    profile = req.session.user
    // console.log(profile) 
    res.render('profile',{profile})
})

// dashboard
app.get('/dashboard',ensureAuth,async(req,res)=>{
    
    var s = req.session.user

    var total = await pool.query('select count(*) from coviddata where "Present_report"=true;')
    total = total.rows
    req.session.user.total = total
    // console.log(total)

    var contacted = await sessions.writeTransaction(tx=>
        tx.run('match (p1:Person)-[:CONTACTED]->(p2:Person) return count(p1)')    
    )
    // console.log(contacted.records[0]._fields[0])
    contacted = contacted.records[0]._fields[0].low
    req.session.user.contacted=contacted
    

    var locations = await pool.query('SELECT d.latitude, d.longitude FROM coviddata as d where d."Present_report"=true;')
    locations = locations.rows
    req.session.user.locations = locations
    req.session.save()
    res.render('dashboard',{total,locations:locations,count:req.session.user.count,district:req.session.user.district,contacted, risk:req.session.user.risk})
  
      
})

// survey
app.get('/survey',ensureAuth,(req,res)=>{
    res.render('survey',)
})

app.post('/survey',async(req,res)=>{
    // var user = req.session.user.fisrt_name+req.session.user.last_name
    var vaccine = req.body.vaccine
    var test = req.body.test
    var symptom = req.body.symptom
    var medhis = req.body.medhis 
    
    var con = await sessions.writeTransaction(tx=>
        tx.run('match (p1:Person)-[:CONTACTED]->(p2:Person)  where p2.email =$email return p1',{email:req.session.user.email})    
    )
    // console.log(con.records.length)

    if(test=="Yes" || con.records.length!=0){
        report = true
        
        if(symptom=="None" && medhis=="None"){
            risk = "Low Risk"
        }else if(symptom!="None" && medhis!="None"){
            risk = "High Risk"
        }else risk = "Medium Risk";

    }else{
        report=false

        if(symptom=="None" && medhis=="None"){
            risk = "No Risk"
        }else if(symptom!="None" && medhis!="None"){
            risk = "Medium Risk"
        }else risk = "Low Risk";

    }



    var date = new Date().toISOString().slice(0,19).replace('T',' ')
    // console.log(date)
    // console.log(risk)

    // console.log(req.session.user)

    var result = await pool.query('UPDATE coviddata SET risk=$1, "Present_report"=$2, date=$3 where id=$4;',[risk,report,date,req.session.user.id])
    // console.log(result)
    req.session.user.risk = risk
    req.session.user.Present_report = report
    res.render('profile',{profile:req.session.user})
})



//filter
app.post('/filter',async(req,res)=>{
    var lat = parseFloat(req.body.lat)
    var lng = parseFloat(req.body.lng)
    
    
    var district = await pool.query('SELECT t1.laa FROM polbnda_ind t1 where st_within(ST_SetSRID(ST_MakePoint($1,$2),4326),t1.geom); ',[lng,lat])
    district = district.rows[0].laa
    // console.log(district.rows[0].laa)
    var count = await pool.query('SELECT count(d.id) FROM coviddata as d, polbnda_ind as t where d."Present_report"=TRUE and t.laa=$1 and st_within(d.geom,t.geom);',[district])
    count = count.rows[0].count
    // console.log(count.rows[0].count)


    req.session.user.district = district
    req.session.user.select = count
    req.session.save()

    res.render('dashboard',{risk:req.session.user.risk,total:req.session.user.total,locations:req.session.user.locations,district,count,contacted:req.session.user.contacted})


})

// Logout
app.post('/logout',(req,res)=>{
    req.session.destroy((err)=>{
        if(err) throw err;
        res.redirect('/')
    })
})


/**  listening to server **/
app.listen(port,()=>{
    console.log('Server started on port 3000')
})


module.exports = app