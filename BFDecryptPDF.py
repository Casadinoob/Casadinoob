import PyPDF2
import time
from tqdm import tqdm

# Specify the PDF file and the dictionary file
pdf_file = "INSERT PDF FILE NAME in the same folder"
dictionary_file = "password.txt"

# Start timing the decryption process
start_time = time.time()

# Open the PDF file
with open(pdf_file, "rb") as pdf:
    pdf_reader = PyPDF2.PdfReader(pdf)

    # Check if the PDF is encrypted
    if not pdf_reader.is_encrypted:
        print("The PDF file is not encrypted.")
    else:
        # Read all passwords into a list
        with open(dictionary_file, "r") as f:
            passwords = f.read().splitlines()

        # Initialize progress bar
with tqdm(total=len(passwords), desc="Trying passwords", unit="password") as pbar:
    for password in passwords:
        password = password.strip()
        try:
            # Try decrypting with the current password
            if pdf_reader.decrypt(password):
                print(f"\nSuccess this was easy bruv! The password is: {password}")
                break
        except Exception as e:
            print(f"Error trying password {password}: {str(e)}")
        
        # Update progress bar and print the current password
        pbar.update(1)
        print(f"Trying password: {password}")
    else:  # This else is associated with the for loop
        print("Password not found in the dictionary.")

# Calculate and display performance metrics
end_time = time.time()
elapsed_time = end_time - start_time
print(f"\nTotal attempts: {len(passwords)}")
print(f"Time taken: {elapsed_time:.2f} seconds")
