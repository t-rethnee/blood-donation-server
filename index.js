// blood-donation-backend/server.js

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dotenv.config();


// Import your Firebase Admin and verifyToken middleware
const admin = require("./config/firebaseAdmin");
const verifyToken = require("./middleware/verifyToken");

const adminVerify = require('./middleware/adminVerify');
const volunteerVerify = require('./middleware/volunteerVerify');



const Stripe = require("stripe");
const stripe = Stripe(process.env.PAYMENT_GATEWAY_KEY); // Add your key in .env

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.w9jdjho.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// MongoDB Client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const checkRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const email = req.user.email; // verifyToken middleware থেকে আসা
      if (!email) return res.status(401).json({ message: "Unauthorized" });

      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ message: "Forbidden: Insufficient role" });
      }

      // role ঠিক আছে, এগিয়ে যাও
      next();
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  };
};


async function run() {
  try {
   // await client.connect();
   // console.log("✅ MongoDB connected");

    const db = client.db("blood_donation_app");

    const usersCollection = db.collection("users");
    const donationRequests = db.collection("donationRequests");
    const donationsCollection = db.collection("donations");
    const blogsCollection = db.collection("blogs");
    const fundingCollection = db.collection("fundings");

    // ---------- USER ROUTES ----------

    app.post("/api/register", async (req, res) => {
      const { email, name, bloodGroup, district, upazila, avatar } = req.body;
      if (!email || !name || !bloodGroup || !district || !upazila) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      const existingUser = await usersCollection.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
      }
      const newUser = {
        email,
        name,
        bloodGroup,
        district,
        upazila,
        avatar: avatar || "",
        role: "donor",
        status: "active",
        createdAt: new Date(),
      };
      const result = await usersCollection.insertOne(newUser);
      res.status(201).json({ insertedId: result.insertedId });
    });

    app.get("/api/users/:email", verifyToken, async (req, res) => {
  const requestedEmail = req.params.email;
  const tokenEmail = req.user.email;  // verifyToken middleware থেকে আসা email

  // Check if token email and requested email match
  if (requestedEmail !== tokenEmail) {
    return res.status(403).json({ message: "Forbidden: Email mismatch" });
  }

  try {
    const user = await usersCollection.findOne({ email: requestedEmail });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


    app.put("/api/users/:email", async (req, res) => {
      const { email } = req.params;
      const updatedData = { ...req.body };
      if ("avatar" in updatedData) delete updatedData.avatar;
      const result = await usersCollection.updateOne({ email }, { $set: updatedData });
      if (result.matchedCount === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json({ message: "User updated", modifiedCount: result.modifiedCount });
    });

    app.get("/api/users", async (req, res) => {
      const { status } = req.query;
      const query = status && status !== "all" ? { status } : {};
      const users = await usersCollection.find(query).toArray();
      res.json(users);
    });

    app.patch("/api/users/:id/status", async (req, res) => {
      const { status } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } }
      );
      result.matchedCount
        ? res.json({ message: "Status updated", modifiedCount: result.modifiedCount })
        : res.status(404).json({ message: "User not found" });
    });

    app.patch("/api/users/:id/role", async (req, res) => {
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role } }
      );
      result.matchedCount
        ? res.json({ message: "Role updated", modifiedCount: result.modifiedCount })
        : res.status(404).json({ message: "User not found" });
    });

    app.get("/api/donors", async (req, res) => {
      const { bloodGroup, district, upazila } = req.query;
      const filter = { role: "donor", status: "active" };
      if (bloodGroup) filter.bloodGroup = bloodGroup;
      if (district) filter.district = district;
      if (upazila) filter.upazila = upazila;
      const donors = await usersCollection.find(filter).toArray();
      res.json(donors);
    });

    // ---------- DONATION REQUEST ROUTES ----------

    app.post("/api/donation-requests", async (req, res) => {
      const donation = { ...req.body, status: "pending", createdAt: new Date() };
      const result = await donationRequests.insertOne(donation);
      res.status(201).json({ insertedId: result.insertedId });
    });

    app.get("/api/donation-requests", async (req, res) => {
      const { status, page = 1, limit = 10 } = req.query;
      const filter = status && status !== "all" ? { status } : {};
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const data = await donationRequests.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).toArray();
      const totalCount = await donationRequests.countDocuments(filter);
      res.json({
        donationRequests: data,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: parseInt(page),
      });
    });

    app.get("/api/donation-requests/recent/:email", async (req, res) => {
      const recent = await donationRequests
        .find({ requesterEmail: req.params.email })
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();
      res.json(recent);
    });

    app.get("/api/donation-requests/by-donor/:email", async (req, res) => {
      const { status } = req.query;
      const query = { requesterEmail: { $regex: `^${req.params.email}$`, $options: "i" } };
      if (["pending", "inprogress", "done", "canceled"].includes(status)) {
        query.status = status;
      }
      const list = await donationRequests.find(query).sort({ createdAt: -1 }).toArray();
      res.json(list);
    });

    app.get("/api/donation-requests/:id", async (req, res) => {
      const found = await donationRequests.findOne({ _id: new ObjectId(req.params.id) });
      found ? res.json(found) : res.status(404).json({ message: "Request not found" });
    });

   app.put("/api/donation-requests/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData._id; // ✅ prevent immutable field error

    const result = await donationRequests.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    res.json({ modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Failed to update donation request:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

    app.patch("/api/donation-requests/confirm-donation/:id", async (req, res) => {
      const { donorName, donorEmail } = req.body;
      const request = await donationRequests.findOne({ _id: new ObjectId(req.params.id) });
      if (!request || request.status !== "pending") {
        return res.status(400).json({ message: "Cannot confirm this request" });
      }
      const update = await donationRequests.updateOne(
        { _id: new ObjectId(req.params.id) },
        {
          $set: {
            status: "inprogress",
            donorName,
            donorEmail,
            updatedAt: new Date(),
          },
        }
      );
      res.json({ message: "Confirmed", modifiedCount: update.modifiedCount });
    });



   app.delete("/api/donation-requests/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await donationRequests.deleteOne({ _id: new ObjectId(id) });
    res.json({ deletedCount: result.deletedCount });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ error: "Failed to delete donation request." });
  }
});
app.patch("/api/donation-requests/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    const allowedStatuses = ["pending", "inprogress", "done", "canceled"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const request = await donationRequests.findOne({ _id: new ObjectId(id) });
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Allow only specific transitions if you want (optional)
    // For example: from inprogress, only allow done or canceled
    if (request.status === "inprogress" && !["done", "canceled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status transition" });
    }

    // Update the status and updatedAt timestamp
    const result = await donationRequests.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ message: "Failed to update status" });
    }

    res.json({ message: "Status updated successfully", modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Failed to update status:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.patch("/api/donation-requests/status/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ["pending", "inprogress", "done", "canceled"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const request = await donationRequests.findOne({ _id: new ObjectId(id) });
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Optional transition logic
    if (request.status === "inprogress" && !["done", "canceled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status transition" });
    }

    const result = await donationRequests.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ message: "Failed to update status" });
    }

    res.json({ message: "Status updated successfully", modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Failed to update status:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


    // ---------- ADMIN STATS ----------

    app.get("/api/admin/stats/donors-count", async (req, res) => {
  try {
    
    const count = await usersCollection.countDocuments({ role: "donor" });
   
   

    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


    app.get("/api/admin/stats/funds", async (req, res) => {
      const result = await donationsCollection.aggregate([
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]).toArray();
      res.json({ total: result[0]?.total || 0 });
    });

    app.get("/api/admin/stats/donation-requests", async (req, res) => {
      const count = await donationRequests.countDocuments({});
      res.json({ count });
    });

    // ---------- BLOG MANAGEMENT ----------

    app.post("/api/blogs", async (req, res) => {
  try {
    const { title, thumbnailUrl, content } = req.body;

    if (!title || !thumbnailUrl || !content) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const newBlog = {
      title,
      thumbnailUrl,
      content,
      status: "draft",
      createdAt: new Date(),
    };

    const result = await blogsCollection.insertOne(newBlog);
    res.status(201).json({ insertedId: result.insertedId });
  } catch (error) {
    console.error("Error creating blog:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


   app.get("/api/blogs", async (req, res) => {
  try {
    const status = req.query.status;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = status && status !== "all" ? { status } : {};

    const totalCount = await blogsCollection.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    const blogs = await blogsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({ blogs, totalPages });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

    app.get("/api/blogs/:id", async (req, res) => {
      const blog = await blogsCollection.findOne({ _id: new ObjectId(req.params.id) });
      blog ? res.json(blog) : res.status(404).json({ message: "Blog not found" });
    });

    app.put("/api/blogs/:id", async (req, res) => {
      const { title, thumbnailUrl, content } = req.body;
      const result = await blogsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { title, thumbnailUrl, content, updatedAt: new Date() } }
      );
      res.json({ message: "Blog updated", modifiedCount: result.modifiedCount });
    });

    app.patch("/api/blogs/:id/status", async (req, res) => {
      const { status } = req.body;
      if (!["draft", "published"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const result = await blogsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } }
      );
      res.json({ message: `Blog ${status === "published" ? "published" : "unpublished"}`, modifiedCount: result.modifiedCount });
    });

    app.delete("/api/blogs/:id", async (req, res) => {
      const result = await blogsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.json({ deletedCount: result.deletedCount });
    });


   //  GET all donation requests for volunteers (no pagination, optional status filter)
app.get("/api/volunteer/donation-requests", async (req, res) => {
  try {
    const { status } = req.query;

    
    const filter = {};
    if (status && status !== "all") {
      filter.status = status.toLowerCase();
    }

    const requests = await donationRequests
      .find(filter)
      .sort({ createdAt: -1 }) // Most recent first
      .toArray();

    res.json({ data: requests }); // Send full list to frontend
  } catch (error) {
    console.error("Error fetching donation requests:", error);
    res.status(500).json({ message: "Failed to get donation requests" });
  }
});



//  PATCH: Update donation request status by volunteer
app.patch("/api/donation-requests/:id/status", async (req, res) => {
  try {
    const { status, donorName, donorEmail } = req.body;
    const id = req.params.id;

    const validStatuses = ["pending", "inprogress", "done", "canceled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const updateData = {
      status,
      updatedAt: new Date(),
    };

    // For inprogress: must include donor name/email
    if (status === "inprogress") {
      if (!donorName || !donorEmail) {
        return res.status(400).json({ message: "Donor info required for inprogress status" });
      }
      updateData.donorName = donorName;
      updateData.donorEmail = donorEmail;
    } else {
      // Clear donor info for other statuses
      updateData.donorName = null;
      updateData.donorEmail = null;
    }

    const result = await donationRequests.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Donation request not found" });
    }

    res.json({ message: "Status updated successfully", modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Error updating donation request status:", error);
    res.status(500).json({ message: "Server error while updating status" });
  }
});



 //  Create Stripe Payment Intent
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      const amountInCents = parseInt(amount * 100);

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error("Stripe Error:", error);
        res.status(500).send({ error: error.message });
      }
    });

    // ✅ Store Funding Data After Successful Payment
app.post("/fundings", async (req, res) => {
  try {
    const fundData = req.body;

    // ✅ Convert amount to a number
    fundData.amount = Number(fundData.amount);

    // ✅ Add createdAt field if missing
    if (!fundData.createdAt) {
      fundData.createdAt = new Date();
    }

    const result = await fundingCollection.insertOne(fundData);
    res.status(201).send(result);
  } catch (error) {
    console.error("Error saving funding data:", error);
    res.status(500).send({ error: error.message });
  }
});


     // ✅ Get All Fundings
    app.get("/fundings", async (req, res) => {
      const result = await fundingCollection.find().sort({ _id: -1 }).toArray();
      res.send(result);
    });
 // ✅ Optional: Get Fundings by User Email
    app.get("/fundings/:email", async (req, res) => {
      const email = req.params.email;
      const result = await fundingCollection
        .find({ email: email })
        .sort({ _id: -1 })
        .toArray();
      res.send(result);
    });
     // ✅ Optional: Delete a Funding (if needed)
    app.delete("/fundings/:id", async (req, res) => {
      const id = req.params.id;
      const result = await fundingCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });
    
app.get("/api/admin/stats/funds/simple-sum", async (req, res) => {
  try {
    const allFundings = await fundingCollection.find().toArray();
    const totalSum = allFundings.reduce((acc, curr) => acc + (curr.amount || 0), 0);
    //console.log("Simple sum of all funding amounts:", totalSum);
    res.send({ total: totalSum });
  } catch (error) {
    console.error("Error in simple sum:", error);
    res.status(500).send({ error: error.message });
  }
});


  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("✅ Donation server is running");
});

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
