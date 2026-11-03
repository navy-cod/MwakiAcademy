(async function () {
  try {
    const res = await fetch("students.json");
    if (!res.ok) throw new Error("Failed to load students");
    let students = await res.json();
    let selectedId = students[0]?.id || -1;

    // Get DOM elements
    const list = document.querySelector(".student-list-items");
    const info = document.querySelector(".student-detail-info");
    const modal = document.getElementById("addModal");
    const editModal = document.getElementById("editModal");

    const form = document.getElementById("addForm");
    const editForm = document.getElementById("editForm");

    const search = document.getElementById("searchInput");
    const sort = document.getElementById("sortSelect");
    const totalEl = document.getElementById("totalStudents");
    const avgEl = document.getElementById("avgGrade");
    const toastContainer = document.getElementById("toastContainer");

    // Toast notification function
    const toast = (msg, type = "success") => {
      const t = document.createElement("div");
      t.className = `toast toast-${type}`;
      
      let icon = "✓";
      if (type === "warning") icon = "⚠";
      if (type === "error") icon = "✕";
      if (type === "info") icon = "ℹ";
      
      t.innerHTML = `<span class="toast-icon">${icon}</span> 
                     <span>${msg}</span>`;
      
      toastContainer.appendChild(t);
      
      setTimeout(() => {
        t.classList.add("hiding");
        setTimeout(() => t.remove(), 500);
      }, 2500);
    };

    // Update statistics
    const updateStats = () => {
      totalEl.textContent = students.length;

      const avg = students.length
        ? Math.round(
            students.reduce((s, e) => s + Number(e.grade), 0) / students.length
          )
        : 0;

      avgEl.textContent = `${avg}%`;
    };

    // Get grade letter based on percentage
    const getGradeLetter = (percentage) => {
      if (percentage >= 80) return "A (Excellent)";
      if (percentage >= 75) return "A- (Very Good)";
      if (percentage >= 70) return "B+ (Good)";
      if (percentage >= 65) return "B (Above Average)";
      if (percentage >= 60) return "B- (Satisfactory)";
      if (percentage >= 55) return "C+ (Fair)";
      if (percentage >= 50) return "C (Pass)";
      if (percentage >= 45) return "C- (Low Pass)";
      if (percentage >= 40) return "D+ (Marginal)";
      if (percentage >= 35) return "D (Fail)";
      return "E (Poor)";
    };

    // Render student list and details
    const render = () => {
      let filtered = [...students];

      const q = search.value.toLowerCase().trim();
      if (q) {
        filtered = filtered.filter(
          (e) =>
            e.firstName.toLowerCase().includes(q) ||
            e.lastName.toLowerCase().includes(q) ||
            e.email.toLowerCase().includes(q) ||
            e.studentId.toLowerCase().includes(q)
        );
      }

      const sortValue = sort.value;

      filtered.sort((a, b) => {
        if (sortValue === "name") return a.firstName.localeCompare(b.firstName);
        if (sortValue === "nameDesc") return b.firstName.localeCompare(a.firstName);
        if (sortValue === "grade") return a.grade - b.grade;
        if (sortValue === "gradeDesc") return b.grade - a.grade;
        if (sortValue === "age") return a.age - b.age;
        if (sortValue === "ageDesc") return b.age - a.age;
        return 0;
      });

      if (!filtered.find((e) => e.id === selectedId)) {
        selectedId = filtered[0]?.id || -1;
      }

      // Render student list
      if (filtered.length) {
        list.innerHTML = filtered
          .map(
            (e) => `
              <div class="student-item ${e.id === selectedId ? "selected" : ""}" data-id="${e.id}">
                <span class="student-item-name">
                  <img src="${e.imageUrl}" alt="${e.firstName}" class="student-item-avatar" onerror="this.src='https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70)}'">
                  ${e.firstName} ${e.lastName} (${e.studentId})
                </span>
                <span class="student-item-actions">
                  <i class="student-edit" data-id="${e.id}" title="Edit">✎</i>
                  <i class="student-delete" data-id="${e.id}" title="Delete">✕</i>
                </span>
              </div>`
          )
          .join("");
      } else {
        list.innerHTML = `<div class="no-results">No students found</div>`;
      }

      // Render student detail
      const student = students.find((e) => e.id === selectedId);

      if (student) {
        info.innerHTML = `
          <img src="${student.imageUrl}" alt="${student.firstName}" onerror="this.src='https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70)}'">
          <span class="student-detail-heading">${student.firstName} ${student.lastName}</span>
          <span class="grade">🎯 ${student.grade}% - ${getGradeLetter(student.grade)}</span>
          <span>🎓 Student ID: ${student.studentId}</span>
          <span>📧 ${student.email}</span>
          <span>📞 ${student.contactNumber}</span>
          <span>📚 Course: ${student.course}</span>
          <span>📍 ${student.address}</span>
          <span>🎂 ${student.dob} (${student.age} years old)</span>
          <div class="student-detail-actions">
            <button class="edit-detail-btn" onclick="window.openEdit(${student.id})">✏️ Edit Student</button>
            <button class="delete-detail-btn" onclick="window.delStudent(${student.id})">🗑️ Delete Student</button>
          </div>`;
      } else {
        info.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">🎓</div>
          <div class="empty-state-text">Select a student to view details</div>
        </div>`;
      }
    };

    // Add Student button click
    document.querySelector(".add-btn").onclick = () => {
      modal.style.display = "flex";
    };

    // Cancel buttons
    document.querySelectorAll(".cancel-btn, .edit-cancel").forEach(btn => {
      btn.onclick = function() {
        const parentModal = this.closest('.modal, .edit-modal');
        if (parentModal) {
          parentModal.style.display = "none";
          const form = parentModal.querySelector('form');
          if (form) form.reset();
        }
      };
    });

    // Close modal when clicking outside
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
        form.reset();
      }
    };

    editModal.onclick = (e) => {
      if (e.target === editModal) {
        editModal.style.display = "none";
        editForm.reset();
      }
    };

    // Add student form submit
    form.onsubmit = (e) => {
      e.preventDefault();

      const formData = new FormData(form);
      
      const newId = Math.max(...students.map(e => e.id), 1000) + 1;
      
      const dobStr = formData.get("dob");
      const dobParts = dobStr.split("-");
      const year = parseInt(dobParts[0]);
      
      const newStudent = {
        id: newId,
        studentId: formData.get("studentId"),
        firstName: formData.get("firstName"),
        lastName: formData.get("lastName"),
        email: formData.get("email"),
        contactNumber: formData.get("contactNumber"),
        grade: Number(formData.get("grade")),
        course: formData.get("course"),
        address: formData.get("address"),
        dob: `${dobParts[2]}/${dobParts[1]}/${dobParts[0]}`,
        age: new Date().getFullYear() - year,
        imageUrl: formData.get("imageUrl") || 
          `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70)}`
      };

      students.push(newStudent);
      selectedId = newId;

      render();
      updateStats();
      toast(`🎓 ${newStudent.firstName} ${newStudent.lastName} added successfully!`, "success");

      modal.style.display = "none";
      form.reset();
    };

    // Open edit modal
    window.openEdit = (id) => {
      const student = students.find(e => e.id === id);
      if (!student) return;

      editForm.editId.value = student.id;
      editForm.editStudentId.value = student.studentId;
      editForm.editFirstName.value = student.firstName;
      editForm.editLastName.value = student.lastName;
      editForm.editEmail.value = student.email;
      editForm.editContactNumber.value = student.contactNumber;
      editForm.editGrade.value = student.grade;
      editForm.editCourse.value = student.course;
      editForm.editAddress.value = student.address;
      editForm.editImageUrl.value = student.imageUrl || '';

      if (student.dob) {
        const [day, month, year] = student.dob.split("/");
        editForm.editDob.value = `${year}-${month}-${day}`;
      }

      editModal.style.display = "flex";
    };

    // Edit form submit
    editForm.onsubmit = (e) => {
      e.preventDefault();

      const formData = new FormData(editForm);
      const studentId = Number(formData.get("editId"));
      const index = students.findIndex(e => e.id === studentId);

      if (index === -1) return;

      const dobStr = editForm.editDob.value;
      const [year, month, day] = dobStr.split("-");

      students[index] = {
        ...students[index],
        studentId: formData.get("editStudentId"),
        firstName: formData.get("editFirstName"),
        lastName: formData.get("editLastName"),
        email: formData.get("editEmail"),
        contactNumber: formData.get("editContactNumber"),
        grade: Number(formData.get("editGrade")),
        course: formData.get("editCourse"),
        address: formData.get("editAddress"),
        imageUrl: formData.get("editImageUrl") || students[index].imageUrl,
        dob: `${day}/${month}/${year}`,
        age: new Date().getFullYear() - Number(year)
      };

      render();
      updateStats();
      toast("Student updated successfully!", "success");

      editModal.style.display = "none";
      editForm.reset();
    };

    // Delete student
    window.delStudent = (id) => {
      if (!confirm("Are you sure you want to delete this student?")) return;

      const student = students.find(e => e.id === id);
      students = students.filter(e => e.id !== id);
      
      if (selectedId === id) {
        selectedId = students[0]?.id || -1;
      }

      render();
      updateStats();
      toast(`${student.firstName} ${student.lastName} has been deleted.`, "warning");
    };

    // Event delegation for list interactions
    list.onclick = (e) => {
      const deleteBtn = e.target.closest(".student-delete");
      const editBtn = e.target.closest(".student-edit");
      const studentItem = e.target.closest(".student-item");

      if (!studentItem) return;

      const studId = Number(studentItem.dataset.id);

      if (deleteBtn) {
        e.stopPropagation();
        delStudent(studId);
      } else if (editBtn) {
        e.stopPropagation();
        openEdit(studId);
      } else {
        selectedId = studId;
        render();
      }
    };

    // Search and sort events
    search.oninput = render;
    sort.onchange = render;

    // Initialize
    render();
    updateStats();

  } catch (error) {
    console.error("Error loading student data:", error);
    document.querySelector(".student-list-items").innerHTML = 
      '<div class="no-results">❌ Error loading data. Make sure students.json exists!</div>';
  }
})();